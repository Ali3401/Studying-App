/* ==========================================================================
   Lucid — PDF import.
   pdf.js gives us positioned text runs; we rebuild lines, infer the body
   size, promote the bigger/bolder lines to headings, notice two-column
   layouts, and render any page that is really a picture.
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

/**
 * @param {ArrayBuffer} buffer
 * @param {{snapshots?:boolean, onProgress?:(n:number,total:number,label:string)=>void}} opts
 */
export async function importPdf(buffer, opts = {}) {
  const pdfjsLib = await lib();
  const task = pdfjsLib.getDocument({
    data: buffer,
    isEvalSupported: false,
    useSystemFonts: true,
    disableFontFace: false,
  });
  const pdf = await task.promise;
  const total = pdf.numPages;

  const meta = await pdf.getMetadata().catch(() => null);
  const pages = [];
  const images = [];
  let textChars = 0;

  for (let p = 1; p <= total; p++) {
    opts.onProgress?.(p, total, `Reading page ${p} of ${total}`);
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const viewport = page.getViewport({ scale: 1 });
    const lines = buildLines(content.items, viewport);
    const chars = lines.reduce((n, l) => n + l.text.length, 0);
    textChars += chars;

    const isPicture = chars < 45;
    let snapshot = null;
    if (opts.snapshots || isPicture) {
      opts.onProgress?.(p, total, `Rendering page ${p}`);
      snapshot = await renderPage(page, isPicture ? 2 : 1.6);
      if (snapshot) images.push({ page: p, blob: snapshot, isPicture });
    }
    pages.push({ n: p, lines, isPicture, snapshot: snapshot ? images.length - 1 : null });
    page.cleanup?.();
  }

  const md = assemble(pages, images, opts);
  const info = meta?.info || {};
  return {
    markdown: md,
    images,
    pageCount: total,
    scanned: textChars < total * 60,
    title: (info.Title || '').trim(),
    author: (info.Author || '').trim(),
  };
}

/* ---------------- line reconstruction ---------------- */

function buildLines(items, viewport) {
  const raw = [];
  for (const it of items) {
    const str = it.str;
    if (!str || !str.trim()) continue;
    const tr = it.transform;
    raw.push({
      text: str,
      x: tr[4],
      y: tr[5],
      size: sizeOf(tr),
      w: it.width || 0,
      font: it.fontName || '',
      bold: /bold|black|heavy|semib/i.test(it.fontName || ''),
      italic: /italic|oblique/i.test(it.fontName || ''),
    });
  }
  if (!raw.length) return [];

  raw.sort((a, b) => (b.y - a.y) || (a.x - b.x));

  // group into visual lines
  const lines = [];
  let cur = null;
  for (const it of raw) {
    const tol = Math.max(2, it.size * 0.45);
    if (cur && Math.abs(cur.y - it.y) <= tol) {
      const gap = it.x - (cur.xEnd ?? it.x);
      const space = gap > it.size * 0.22 && !/\s$/.test(cur.text) && !/^\s/.test(it.text) ? ' ' : '';
      cur.text += space + it.text;
      cur.xEnd = it.x + it.w;
      cur.size = Math.max(cur.size, it.size);
      cur.bold = cur.bold && it.bold;
      cur.italic = cur.italic && it.italic;
    } else {
      cur = { text: it.text, x: it.x, xEnd: it.x + it.w, y: it.y, size: it.size, bold: it.bold, italic: it.italic };
      lines.push(cur);
    }
  }
  lines.forEach(l => { l.text = l.text.replace(/\s+/g, ' ').trim(); });

  return orderColumns(lines.filter(l => l.text), viewport);
}

/** If the page is two columns, read the left one fully before the right. */
function orderColumns(lines, viewport) {
  if (lines.length < 12) return lines;
  const mid = viewport.width / 2;
  const left = lines.filter(l => l.xEnd <= mid + viewport.width * 0.04);
  const right = lines.filter(l => l.x >= mid - viewport.width * 0.04);
  if (left.length < 5 || right.length < 5) return lines;
  if (left.length + right.length < lines.length * 0.85) return lines;
  // real two-column pages have both columns spanning a similar vertical range
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

/* ---------------- assembly ---------------- */

function assemble(pages, images, opts) {
  const all = pages.flatMap(p => p.lines);
  const sizes = all.map(l => Math.round(l.size * 2) / 2);
  const body = mode(sizes) || 10;

  const out = [];
  const push = (line) => {
    if (line === '' && out[out.length - 1] === '') return;
    out.push(line);
  };

  for (const page of pages) {
    if (page.isPicture && page.snapshot !== null) {
      push(''); push(`## Page ${page.n}`); push('');
      push(`![Page ${page.n}](IMG:${page.snapshot})`); push('');
      continue;
    }

    const gaps = [];
    for (let i = 1; i < page.lines.length; i++) {
      const g = page.lines[i - 1].y - page.lines[i].y;
      if (g > 0 && g < body * 6) gaps.push(g);
    }
    gaps.sort((a, b) => a - b);
    // headings and paragraph breaks inflate the median, so take a low
    // percentile: on a text page the ordinary line leading dominates
    const leading = gaps.length ? gaps[Math.floor(gaps.length * 0.3)] : body * 1.3;
    const paraGap = leading * 1.35;

    page.lines.forEach((line, i) => {
      const s = line.text;
      if (!s) return;

      // a wider-than-usual vertical gap means a new paragraph
      if (i > 0) {
        const g = page.lines[i - 1].y - line.y;
        if (g > paraGap) push('');
      }

      const ratio = line.size / body;
      let prefix = '';
      const short = s.length <= 90;
      const endsClean = !/[.,;:]$/.test(s);
      if (short && endsClean) {
        if (ratio >= 1.55) prefix = '## ';
        else if (ratio >= 1.25) prefix = '### ';
        else if (ratio >= 1.1 || (line.bold && s.length <= 62)) prefix = '#### ';
      }
      if (prefix) push('');
      push(prefix + s);
      if (prefix) push('');
    });

    if (opts.snapshots && page.snapshot !== null && !page.isPicture) {
      push(''); push(`![Page ${page.n}](IMG:${page.snapshot})`); push('');
    }
    push('');
  }
  return out.join('\n');
}

function mode(arr) {
  const m = new Map();
  for (const v of arr) m.set(v, (m.get(v) || 0) + 1);
  let best = null, n = 0;
  for (const [k, c] of m) if (c > n) { n = c; best = k; }
  return best;
}
