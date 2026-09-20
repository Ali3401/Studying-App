/* ==========================================================================
   Lucid — PDF import.

   pdf.js hands us positioned text runs. Turning those back into a readable
   document means reconstructing what the layout was telling you:

     · the modal font size is the body; anything larger is a heading, ranked
       by size rather than by some absolute ratio, because a handout may only
       separate its headings by two points
     · a whole line set in bold at body size is almost always a heading too —
       which needs the *real* font, not item.fontName, which is an internal id
       like "g_d0_f1" and never contains the word "bold"
     · a bullet is often a glyph with no Unicode mapping, so it arrives as an
       empty string with a width; the indent it leaves behind is the only
       evidence the line was ever a list item
     · a line that repeats at the same place on most pages is furniture
     · a slide deck exported to PDF wants its top line treated as a title
   ========================================================================== */

let pdfjs = null;

async function lib() {
  if (pdfjs) return pdfjs;
  pdfjs = await import('../../vendor/pdf.min.mjs');
  try {
    const worker = new Worker(new URL('../../vendor/pdf.worker.min.mjs', import.meta.url), { type: 'module' });
    pdfjs.GlobalWorkerOptions.workerPort = worker;
  } catch {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('../../vendor/pdf.worker.min.mjs', import.meta.url).href;
  }
  return pdfjs;
}

const sizeOf = (tr) => Math.abs(tr[3]) || Math.hypot(tr[2], tr[3]) || 10;
const round1 = (n) => Math.round(n * 2) / 2;
const BULLET_GLYPHS = '\u2022\u25cf\u25aa\u25ab\u25e6\u2023\u2219\u00b7\u2013\u2014*-o';

/* Word and PowerPoint draw bullets with the Symbol and Wingdings fonts, whose
   glyphs have no real Unicode meaning — pdf.js hands them back in the Private
   Use Area (U+F0B7 is Symbol's bullet). They render as empty boxes, and they
   are not whitespace, so they survive trimming and quietly become the first
   "letter" of the line. Strip them, and treat one at the start of a line as
   the bullet it actually was. */
const PUA = /[\ue000-\uf8ff]/gu;
const INVISIBLE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u00ad\u200b-\u200f\u2028\u2029\ufeff]/gu;
const visibleText = (s) => String(s || '').replace(PUA, '').replace(INVISIBLE, '');

/**
 * @param {ArrayBuffer} buffer
 * @param {{images?:'none'|'figures'|'all', onProgress?:Function}} opts
 */
export async function importPdf(buffer, opts = {}) {
  const lib_ = await lib();
  const pdf = await lib_.getDocument({
    data: buffer,
    isEvalSupported: false,
    useSystemFonts: true,
    disableFontFace: false,
  }).promise;

  const total = pdf.numPages;
  const meta = await pdf.getMetadata().catch(() => null);
  const info = meta?.info || {};
  const imageMode = opts.images || 'figures';

  const pages = [];
  const images = [];
  let textChars = 0;
  let landscape = 0;

  for (let p = 1; p <= total; p++) {
    opts.onProgress?.(p, total, `Reading page ${p} of ${total}`);
    const page = await pdf.getPage(p);
    const viewport = page.getViewport({ scale: 1 });
    if (viewport.width > viewport.height) landscape++;

    // the operator list resolves real fonts into commonObjs and tells us how
    // many pictures the page draws — both cheap, ~8ms a page
    let drawnImages = 0;
    try {
      const ops = await page.getOperatorList();
      const OPS = lib_.OPS;
      for (const fn of ops.fnArray) {
        if (fn === OPS.paintImageXObject || fn === OPS.paintJpegXObject || fn === OPS.paintInlineImageXObject) drawnImages++;
      }
    } catch { /* fonts fall back to the name test below */ }

    const content = await page.getTextContent();
    const lines = buildLines(content.items, page, viewport);
    const chars = lines.reduce((n, l) => n + l.text.length, 0);
    textChars += chars;

    pages.push({ n: p, lines, chars, drawnImages, viewport, snapshot: null });
    page.cleanup?.();
  }

  const slideLike = looksLikeSlides(info, pages, landscape, total);

  // decide which pages to turn into pictures, then render only those
  for (const page of pages) {
    const scattered = isScatteredLabels(page);
    const isPicture = (page.chars < 45 && page.drawnImages > 0) || scattered;
    const wanted = imageMode === 'all' ? true : imageMode === 'figures' ? isPicture : false;
    page.isPicture = isPicture;
    page.scattered = scattered;
    if (!wanted) continue;
    opts.onProgress?.(page.n, total, `Rendering page ${page.n}`);
    const blob = await renderPage(await pdf.getPage(page.n), isPicture ? 2 : 1.6);
    if (blob) { images.push({ page: page.n, blob, isPicture }); page.snapshot = images.length - 1; }
  }

  const markdown = slideLike
    ? assembleSlides(pages, { imageMode })
    : assemble(pages, { imageMode });

  return {
    markdown,
    lines: opts.debug ? pages.map(p => ({ page: p.n, lines: p.lines, drawnImages: p.drawnImages, chars: p.chars, isPicture: p.isPicture })) : undefined,
    images,
    pageCount: total,
    scanned: textChars < total * 60,
    slideLike,
    title: (info.Title || '').trim(),
    author: (info.Author || '').trim(),
  };
}

/* ---------------- line reconstruction ---------------- */

function buildLines(items, page, viewport) {
  const fontCache = new Map();
  const fontOf = (name) => {
    if (!name) return null;
    if (fontCache.has(name)) return fontCache.get(name);
    let f = null;
    try { if (page.commonObjs?.has?.(name)) f = page.commonObjs.get(name); } catch { /* not ready */ }
    fontCache.set(name, f);
    return f;
  };

  // keep zero-text items: a bullet whose glyph has no Unicode mapping arrives
  // as an empty string, and its width is the only sign it was ever there
  const raw = [];
  for (const it of items) {
    const tr = it.transform;
    const font = fontOf(it.fontName);
    const name = font?.name || it.fontName || '';
    const text = visibleText(it.str);
    raw.push({
      text,
      x: tr[4],
      y: tr[5],
      w: it.width || 0,
      size: sizeOf(tr),
      bold: font ? !!font.bold : /bold|black|heavy|semib/i.test(name),
      italic: font ? !!font.italic : /italic|oblique/i.test(name),
      symbol: /symbol|dingbat|wingding|webding/i.test(name),
      printable: !!text.trim(),
      // it drew something, but nothing you can read: a bullet glyph
      glyph: !text.trim() && (it.width || 0) > 0.5,
      bulletChar: text.trim().length === 1 && BULLET_GLYPHS.includes(text.trim()),
    });
  }
  if (!raw.length) return [];

  raw.sort((a, b) => (b.y - a.y) || (a.x - b.x));

  const lines = [];
  let cur = null;
  for (const it of raw) {
    const tol = Math.max(2, it.size * 0.45);
    if (!cur || Math.abs(cur.y - it.y) > tol) {
      cur = { parts: [], y: it.y, x: Infinity, xEnd: -Infinity };
      lines.push(cur);
    }
    cur.parts.push(it);
    if (it.printable) {
      cur.x = Math.min(cur.x, it.x);
      cur.xEnd = Math.max(cur.xEnd, it.x + it.w);
    }
  }

  const out = [];
  for (const line of lines) {
    const printable = line.parts.filter(p => p.printable);
    if (!printable.length) continue;

    // anything drawn before the first real word that takes up space but says
    // nothing was a bullet glyph the font could not map
    const firstX = printable[0].x;
    const unmapped = line.parts.some(p => p.glyph && p.x < firstX - 0.5);
    const literal = printable.length > 1 && printable[0].bulletChar;
    const marker = unmapped || literal;

    const parts = literal ? printable.slice(1) : printable;
    if (!parts.length) continue;

    let text = '';
    let prev = null;
    for (const p of parts) {
      const gap = prev ? p.x - (prev.x + prev.w) : 0;
      const space = prev && gap > p.size * 0.22 && !/\s$/.test(text) && !/^\s/.test(p.text) ? ' ' : '';
      text += space + p.text;
      prev = p;
    }
    text = text.replace(/\s+/g, ' ').trim();
    if (!text) continue;

    const body = parts.filter(p => p.printable);
    out.push({
      text,
      x: Math.min(...body.map(p => p.x)),
      y: line.y,
      size: Math.max(...body.map(p => p.size)),
      bold: body.every(p => p.bold),
      italic: body.every(p => p.italic),
      bullet: marker,
    });
  }

  return orderColumns(out, viewport);
}

/** If the page is two columns, read the left one fully before the right. */
function orderColumns(lines, viewport) {
  if (lines.length < 12) return lines;
  const mid = viewport.width / 2;
  const left = lines.filter(l => l.x < mid);
  const right = lines.filter(l => l.x >= mid);
  if (left.length < 5 || right.length < 5) return lines;
  const span = (ls) => { const ys = ls.map(l => l.y); return Math.max(...ys) - Math.min(...ys); };
  const pageSpan = span(lines);
  if (span(left) < pageSpan * 0.5 || span(right) < pageSpan * 0.5) return lines;
  return [...left, ...right];
}

/* ---------------- page rendering ---------------- */

async function renderPage(page, scale = 1.6) {
  try {
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.min(2200, Math.round(viewport.width));
    canvas.height = Math.round(viewport.height * (canvas.width / viewport.width));
    const ctx = canvas.getContext('2d', { alpha: false });
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const rescaled = page.getViewport({ scale: scale * (canvas.width / viewport.width) });
    await page.render({ canvasContext: ctx, viewport: rescaled, background: '#ffffff' }).promise;
    return await new Promise(res => canvas.toBlob(b => res(b), 'image/jpeg', 0.86));
  } catch (e) {
    console.warn('[lucid] page render failed', e);
    return null;
  }
}

/* ---------------- document shape ---------------- */

/**
 * A page whose "text" is really axis labels and callouts scattered across a
 * graph. Extracting it gives you word salad, so a picture of it is the note.
 *
 * Judged on the shape of the text alone. The number of images a page draws
 * looks like the obvious signal and is not: PowerPoint renders gradients,
 * shadows and even its own bullet glyphs as images, so an ordinary bulleted
 * slide can draw seventy of them while a real graph draws two.
 */
function isScatteredLabels(page) {
  if (page.lines.length < 10) return false;
  const lengths = page.lines.map(l => l.text.length).sort((a, b) => a - b);
  return lengths[Math.floor(lengths.length / 2)] <= 10;
}

function looksLikeSlides(info, pages, landscape, total) {
  const from = `${info.Creator || ''} ${info.Producer || ''}`;
  if (/powerpoint|keynote|impress|google slides/i.test(from)) return true;
  if (landscape < total * 0.8) return false;
  const sparse = pages.filter(p => p.chars < 600).length;
  return sparse > total * 0.7;
}

/** Lines that repeat in the same place on most pages are running heads. */
function furnitureLines(pages) {
  const seen = new Map();
  for (const page of pages) {
    const edge = [...page.lines.slice(0, 2), ...page.lines.slice(-2)];
    for (const line of edge) {
      const key = line.text.replace(/\d+/g, '#').trim().toLowerCase();
      if (key.length < 3) continue;
      if (!seen.has(key)) seen.set(key, new Set());
      seen.get(key).add(page.n);
    }
  }
  const threshold = Math.max(2, pages.length * 0.5);
  const out = new Set();
  for (const [key, onPages] of seen) if (onPages.size >= threshold) out.add(key);
  return out;
}

function mode(values) {
  const m = new Map();
  for (const v of values) m.set(v.key, (m.get(v.key) || 0) + v.weight);
  let best = null, n = -1;
  for (const [k, c] of m) if (c > n) { n = c; best = k; }
  return best;
}

/**
 * A slide deck exported to PDF.
 *
 * Slides are not documents: the body text is already 32pt, so ranking font
 * sizes would make every line a heading. Instead each page contributes its
 * top line (or the run of lines sharing the largest size) as a heading, and
 * everything below it is body text — heavily rewrapped, because a slide
 * breaks a sentence every four or five words.
 */
function assembleSlides(pages, { imageMode }) {
  const furniture = furnitureLines(pages);
  const isFurniture = (line) => {
    const s = line.text.trim();
    if (/^(page\s*)?\d{1,4}(\s*(of|\/)\s*\d{1,4})?$/i.test(s)) return true;
    return furniture.has(s.replace(/\d+/g, '#').trim().toLowerCase());
  };

  const out = [];
  const push = (line) => { if (line === '' && out[out.length - 1] === '') return; out.push(line); };

  pages.forEach((page, index) => {
    const lines = page.lines.filter(l => !isFurniture(l));

    if (page.snapshot !== null && (page.isPicture || imageMode === 'all')) {
      const caption = page.scattered || !lines.length ? `Slide ${page.n}` : lines[0].text.slice(0, 80);
      push('');
      push(`## ${caption}`);
      push('');
      push(`![Slide ${page.n}](IMG:${page.snapshot})`);
      push('');
      // the "text" on a graph slide is scattered labels; the picture is the note
      if (page.scattered || !lines.length) return;
    }
    if (!lines.length) return;

    // The title is the line at the top, plus any that continue it at the same
    // size — not "every line of the largest size", which on a slide whose body
    // is also 32pt swallows the whole slide.
    let cut = 0;
    if (!lines[0].bullet) {
      const size = round1(lines[0].size);
      cut = 1;
      while (cut < lines.length && cut < 4) {
        const l = lines[cut];
        if (l.bullet || round1(l.size) !== size) break;
        if (lines[cut - 1].y - l.y > size * 2.2) break;
        cut++;
      }
      // a title that long was never a title
      if (lines.slice(0, cut).reduce((n, l) => n + l.text.length, 0) > 90) cut = lines[0].text.length <= 90 ? 1 : 0;
    }
    const title = lines.slice(0, cut).map(l => l.text).join(' ').replace(/\s+/g, ' ').trim();
    const rest = lines.slice(cut);

    push('');
    push('## ' + (title || `Slide ${page.n}`));
    push('');

    // gaps tell us where one point ends and the next begins
    const gaps = [];
    for (let i = 1; i < rest.length; i++) {
      const g = rest[i - 1].y - rest[i].y;
      if (g > 0) gaps.push(g);
    }
    gaps.sort((a, b) => a - b);
    const leading = gaps.length ? gaps[Math.floor(gaps.length * 0.4)] : 20;

    let flowX = null;
    rest.forEach((line, i) => {
      const s = line.text;
      if (!s) return;
      const gap = i > 0 ? rest[i - 1].y - line.y : 0;
      const newBlock = i === 0 || gap > leading * 1.6 || line.bullet;

      if (line.bullet) {
        flowX = textStartOf(line, rest, i);
        push('- ' + s);
        return;
      }
      if (!newBlock && flowX !== null && Math.abs(line.x - flowX) < 8 && out.length) {
        out[out.length - 1] += ' ' + s;
        return;
      }
      flowX = line.x;
      push(s);
    });

    push('');
  });

  return out.join('\n');
}

/** Where a bullet's text begins, so its wrapped lines can be recognised. */
function textStartOf(line, lines, i) {
  const next = lines[i + 1];
  if (next && next.y < line.y && !next.bullet && next.x > line.x) return next.x;
  return line.x;
}

/* ---------------- assembly ---------------- */

function assemble(pages, { imageMode }) {
  const furniture = furnitureLines(pages);
  const isFurniture = (line) => {
    const s = line.text.trim();
    if (/^(page\s*)?\d{1,4}(\s*(of|\/)\s*\d{1,4})?$/i.test(s)) return true;
    return furniture.has(s.replace(/\d+/g, '#').trim().toLowerCase());
  };

  const all = pages.flatMap(p => p.lines.filter(l => !isFurniture(l)));
  if (!all.length) return '';

  const bodySize = mode(all.map(l => ({ key: round1(l.size), weight: l.text.length }))) || 12;
  const leftMargin = mode(all.map(l => ({ key: Math.round(l.x / 4) * 4, weight: 1 }))) ?? 0;

  // Rank the sizes above the body. The *heaviest* heading size is the one the
  // document uses for its sections, so that becomes h2 — anything larger is a
  // one-off cover title and joins it, rather than pushing every real heading
  // down a level.
  const weights = new Map();
  for (const l of all) {
    const k = round1(l.size);
    if (k > bodySize + 0.4) weights.set(k, (weights.get(k) || 0) + l.text.length);
  }
  const headingSizes = [...weights.keys()].sort((a, b) => b - a);
  const dominant = headingSizes.length
    ? [...weights.entries()].sort((a, b) => b[1] - a[1])[0][0]
    : null;
  const below = headingSizes.filter(s => s < dominant);
  const levelForSize = (size) => {
    const k = round1(size);
    if (dominant === null || !weights.has(k)) return 0;
    if (k >= dominant) return 2;
    return Math.min(4, 3 + below.indexOf(k));
  };

  const out = [];
  const push = (line) => { if (line === '' && out[out.length - 1] === '') return; out.push(line); };

  for (const page of pages) {
    const lines = page.lines.filter(l => !isFurniture(l));

    if (page.snapshot !== null && page.isPicture) {
      push(''); push(`![Page ${page.n}](IMG:${page.snapshot})`); push('');
      if (page.scattered || !lines.length) continue;
    }
    if (!lines.length) continue;

    const gaps = [];
    for (let i = 1; i < lines.length; i++) {
      const g = lines[i - 1].y - lines[i].y;
      if (g > 0 && g < bodySize * 6) gaps.push(g);
    }
    gaps.sort((a, b) => a - b);
    const leading = gaps.length ? gaps[Math.floor(gaps.length * 0.3)] : bodySize * 1.3;
    const paraGap = leading * 1.35;

    let bulletIndent = null;
    lines.forEach((line, i) => {
      const s = line.text;
      if (!s) return;

      if (i > 0) {
        const g = lines[i - 1].y - line.y;
        if (g > paraGap) { push(''); bulletIndent = null; }
      }

      // a heading may end in a colon — lecture handouts are full of them
      const endsOpen = !/[.,;!?]$/.test(s);
      const short = s.length <= 95;
      let level = short && endsOpen ? levelForSize(line.size) : 0;
      // a whole line set in bold at body size is a sub-heading; keeping them
      // all at one level beats guessing a hierarchy and getting it wrong
      if (!level && short && endsOpen && line.bold && !line.bullet && round1(line.size) >= bodySize) {
        level = 3;
      }

      if (level) { push(''); push('#'.repeat(level) + ' ' + s); push(''); bulletIndent = null; return; }

      if (line.bullet) {
        const depth = Math.max(0, Math.min(3, Math.round((line.x - leftMargin) / Math.max(8, bodySize * 1.4)) - 1));
        bulletIndent = textStartOf(line, lines, i);
        push('  '.repeat(depth) + '- ' + s);
        return;
      }

      // a wrapped line sitting under a bullet's text belongs to that bullet
      if (bulletIndent !== null && Math.abs(line.x - bulletIndent) < 4 && out.length) {
        out[out.length - 1] += ' ' + s;
        return;
      }
      bulletIndent = null;

      if (/^(fig(ure)?\.?|table|chart|diagram)\s*\d/i.test(s) && s.length < 120) {
        push('*' + s + '*');
        return;
      }

      push(s);
    });

    if (imageMode === 'all' && page.snapshot !== null && !page.isPicture) {
      push(''); push(`![Page ${page.n}](IMG:${page.snapshot})`); push('');
    }
    push('');
  }

  return out.join('\n');
}
