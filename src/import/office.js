/* ==========================================================================
   Lucid — PowerPoint (.pptx) and Word (.docx) import.
   Both are zip files full of XML; we read the parts we care about with
   JSZip + DOMParser and emit Lucid Markdown.
   ========================================================================== */

let zipLib = null;

async function JSZipLib() {
  if (zipLib) return zipLib;
  if (window.JSZip) return (zipLib = window.JSZip);
  await new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = new URL('../../vendor/jszip.min.js', import.meta.url).href;
    s.onload = res; s.onerror = () => rej(new Error('Could not load the zip reader'));
    document.head.append(s);
  });
  if (!window.JSZip) throw new Error('Could not load the zip reader');
  return (zipLib = window.JSZip);
}

/* ---------------- xml helpers ---------------- */

const parseXml = (text) => new DOMParser().parseFromString(text, 'application/xml');

function findAll(node, localName, out = []) {
  for (const child of node.children || []) {
    if (child.localName === localName) out.push(child);
    findAll(child, localName, out);
  }
  return out;
}

const firstOf = (node, localName) => findAll(node, localName)[0] || null;
const attr = (node, name) => {
  if (!node) return null;
  for (const a of node.attributes || []) if (a.localName === name) return a.value;
  return null;
};

const textOf = (node) => findAll(node, 't').map(t => t.textContent).join('');

async function relsFor(zip, partPath) {
  const dir = partPath.slice(0, partPath.lastIndexOf('/'));
  const name = partPath.slice(partPath.lastIndexOf('/') + 1);
  const file = zip.file(`${dir}/_rels/${name}.rels`);
  const map = new Map();
  if (!file) return map;
  const xml = parseXml(await file.async('text'));
  for (const rel of findAll(xml.documentElement, 'Relationship')) {
    map.set(attr(rel, 'Id'), { target: attr(rel, 'Target'), type: attr(rel, 'Type') || '' });
  }
  return map;
}

function resolvePath(base, target) {
  if (target.startsWith('/')) return target.slice(1);
  const parts = base.split('/').slice(0, -1);
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}

const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml', emf: '', wmf: '', tif: '', tiff: '' };

async function grabImage(zip, path, images, seen) {
  if (seen.has(path)) return seen.get(path);
  const ext = (path.split('.').pop() || '').toLowerCase();
  const type = MIME[ext];
  if (!type) return null;                 // EMF/WMF can't be shown in a browser
  const file = zip.file(path);
  if (!file) return null;
  const blob = new Blob([await file.async('arraybuffer')], { type });
  if (blob.size < 2500) return null;      // bullets, rules and logos
  const idx = images.push({ blob, name: path.split('/').pop() }) - 1;
  seen.set(path, idx);
  return idx;
}

/* ==========================  PPTX  ========================== */

export async function importPptx(buffer, opts = {}) {
  const JSZip = await JSZipLib();
  const zip = await JSZip.loadAsync(buffer);

  const slidePaths = Object.keys(zip.files)
    .filter(p => /^ppt\/slides\/slide\d+\.xml$/.test(p))
    .sort((a, b) => num(a) - num(b));

  const images = [];
  const seen = new Map();
  const out = [];
  let title = '';

  const core = zip.file('docProps/core.xml');
  if (core) {
    const x = parseXml(await core.async('text'));
    title = (firstOf(x.documentElement, 'title')?.textContent || '').trim();
  }

  for (let i = 0; i < slidePaths.length; i++) {
    const path = slidePaths[i];
    opts.onProgress?.(i + 1, slidePaths.length, `Reading slide ${i + 1} of ${slidePaths.length}`);
    const xml = parseXml(await zip.file(path).async('text'));
    const rels = await relsFor(zip, path);
    const root = xml.documentElement;

    const shapes = findAll(root, 'sp');
    let slideTitle = '';
    const bodies = [];

    for (const sp of shapes) {
      const ph = firstOf(sp, 'ph');
      const phType = attr(ph, 'type') || '';
      const txBody = firstOf(sp, 'txBody');
      if (!txBody) continue;
      const paras = findAll(txBody, 'p').map(p => ({
        text: textOf(p).replace(/\s+/g, ' ').trim(),
        level: +(attr(firstOf(p, 'pPr'), 'lvl') || 0),
        bullet: !firstOf(p, 'buNone'),
      })).filter(p => p.text);
      if (!paras.length) continue;
      if (!slideTitle && (phType === 'title' || phType === 'ctrTitle')) slideTitle = paras.map(p => p.text).join(' — ');
      else bodies.push(paras);
    }

    if (!slideTitle) {
      // no title placeholder: use the first short line as the heading
      const firstPara = bodies[0]?.[0];
      if (firstPara && firstPara.text.length <= 80) { slideTitle = firstPara.text; bodies[0].shift(); }
    }

    out.push(`## ${slideTitle || `Slide ${i + 1}`}`, '');

    for (const paras of bodies) {
      for (const p of paras) {
        if (!p.text) continue;
        const indent = '  '.repeat(Math.min(3, p.level));
        const looksLikeProse = !p.bullet && p.text.length > 130;
        out.push(looksLikeProse ? p.text : `${indent}- ${p.text}`);
      }
      out.push('');
    }

    if (opts.images !== false) {
      for (const pic of findAll(root, 'pic')) {
        const blip = firstOf(pic, 'blip');
        const rid = attr(blip, 'embed') || attr(blip, 'link');
        const rel = rels.get(rid);
        if (!rel) continue;
        const idx = await grabImage(zip, resolvePath(path, rel.target), images, seen);
        if (idx === null) continue;
        const name = firstOf(pic, 'cNvPr');
        out.push(`![${(attr(name, 'descr') || attr(name, 'name') || `Slide ${i + 1}`).replace(/[[\]]/g, '')}](IMG:${idx})`, '');
      }
    }

    if (opts.notes !== false) {
      const noteRel = Array.from(rels.values()).find(r => r.type.endsWith('/notesSlide'));
      if (noteRel) {
        const notePath = resolvePath(path, noteRel.target);
        const nf = zip.file(notePath);
        if (nf) {
          const nx = parseXml(await nf.async('text'));
          const noteText = findAll(nx.documentElement, 'p')
            .map(p => textOf(p).replace(/\s+/g, ' ').trim())
            .filter(t => t && !/^\d+$/.test(t))
            .join('\n');
          if (noteText.trim().length > 4) out.push('::: note Speaker notes', noteText, ':::', '');
        }
      }
    }
  }

  return { markdown: out.join('\n'), images, title, slideCount: slidePaths.length };
}

const num = (s) => +(/(\d+)/.exec(s)?.[1] || 0);

/* ==========================  DOCX  ========================== */

export async function importDocx(buffer, opts = {}) {
  const JSZip = await JSZipLib();
  const zip = await JSZip.loadAsync(buffer);
  const docFile = zip.file('word/document.xml');
  if (!docFile) throw new Error('This .docx has no document part');

  const xml = parseXml(await docFile.async('text'));
  const rels = await relsFor(zip, 'word/document.xml');
  const images = [];
  const seen = new Map();
  const out = [];

  let title = '';
  const core = zip.file('docProps/core.xml');
  if (core) {
    const x = parseXml(await core.async('text'));
    title = (firstOf(x.documentElement, 'title')?.textContent || '').trim();
  }

  const body = firstOf(xml.documentElement, 'body');
  if (!body) throw new Error('Empty document');

  const children = Array.from(body.children);
  for (let i = 0; i < children.length; i++) {
    const node = children[i];
    opts.onProgress?.(i + 1, children.length, 'Reading document');

    if (node.localName === 'tbl') { out.push(...tableToMd(node), ''); continue; }
    if (node.localName !== 'p') continue;

    const pPr = firstOf(node, 'pPr');
    const styleEl = pPr ? firstOf(pPr, 'pStyle') : null;
    const style = (attr(styleEl, 'val') || '').toLowerCase();
    const numPr = pPr ? firstOf(pPr, 'numPr') : null;
    const level = numPr ? +(attr(firstOf(numPr, 'ilvl'), 'val') || 0) : 0;

    const text = runsToMd(node);

    if (opts.images !== false) {
      for (const blip of findAll(node, 'blip')) {
        const rid = attr(blip, 'embed') || attr(blip, 'link');
        const rel = rels.get(rid);
        if (!rel) continue;
        const idx = await grabImage(zip, resolvePath('word/document.xml', rel.target), images, seen);
        if (idx !== null) out.push('', `![Figure](IMG:${idx})`, '');
      }
    }

    if (!text.trim()) { out.push(''); continue; }

    const hm = /^heading\s*(\d)/.exec(style);
    if (hm) out.push('', '#'.repeat(Math.min(4, Math.max(2, +hm[1] + 1))) + ' ' + stripMd(text), '');
    else if (style === 'title') { if (!title) title = stripMd(text); out.push('', '## ' + stripMd(text), ''); }
    else if (style === 'subtitle') out.push('', '*' + stripMd(text) + '*', '');
    else if (style.includes('quote')) out.push('> ' + text);
    else if (numPr) out.push('  '.repeat(Math.min(3, level)) + (style.includes('number') ? '1. ' : '- ') + text);
    else if (style.includes('listparagraph')) out.push('- ' + text);
    else out.push(text, '');
  }

  return { markdown: out.join('\n'), images, title };
}

function runsToMd(p) {
  let out = '';
  for (const r of findAll(p, 'r')) {
    const t = findAll(r, 't').map(n => n.textContent).join('');
    const brs = findAll(r, 'br').length;
    if (!t) { out += brs ? '\n' : ''; continue; }
    const rPr = firstOf(r, 'rPr');
    const bold = rPr && findAll(rPr, 'b').some(b => attr(b, 'val') !== '0' && attr(b, 'val') !== 'false');
    const ital = rPr && findAll(rPr, 'i').some(b => attr(b, 'val') !== '0' && attr(b, 'val') !== 'false');
    const hl = rPr && firstOf(rPr, 'highlight');
    let chunk = t;
    if (bold) chunk = `**${chunk.trim()}** `.replace(/\s+$/, ' ');
    if (ital) chunk = `*${chunk.trim()}* `.replace(/\s+$/, ' ');
    if (hl && !bold && !ital) chunk = `==${chunk.trim()}== `;
    out += chunk;
  }
  return out.replace(/\s+/g, ' ').trim();
}

function tableToMd(tbl) {
  const rows = findAll(tbl, 'tr').map(tr =>
    findAll(tr, 'tc').map(tc => findAll(tc, 'p').map(runsToMd).join(' ').replace(/\|/g, '\\|').trim()));
  if (!rows.length) return [];
  const width = Math.max(...rows.map(r => r.length));
  const pad = (r) => { const c = r.slice(); while (c.length < width) c.push(''); return c; };
  const head = pad(rows[0]);
  const out = ['| ' + head.join(' | ') + ' |', '| ' + head.map(() => '---').join(' | ') + ' |'];
  for (const r of rows.slice(1)) out.push('| ' + pad(r).join(' | ') + ' |');
  return out;
}

const stripMd = (s) => s.replace(/[*_=`]/g, '').trim();
