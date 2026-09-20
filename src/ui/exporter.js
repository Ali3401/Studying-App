/* Lucid — export a note as Markdown, a self-contained HTML page, or JSON;
   and print (which is how you save a PDF on iPad). */

import { el, downloadText, downloadBlob, escapeHtml, slug, copyText } from '../core/util.js';
import * as store from '../core/store.js';
import { parse } from '../parse/lmd.js';
import { render as renderAst } from '../parse/render.js';
import { sheet, closeSheet, toast } from './ui.js';

export function exportDoc(doc) {
  sheet({
    title: 'Export “' + (doc.title || 'note') + '”',
    body: el('div', { class: 'group', style: { gap: 'var(--gap-2)' } },
      opt('Markdown (.md)', 'Plain text with all the Lucid blocks intact — reopens perfectly here, reads fine anywhere else.', 'save', () => {
        downloadText(doc.markdown, slug(doc.title) + '.md', 'text/markdown');
        closeSheet(); toast('Markdown saved', { icon: 'download' });
      }),
      opt('Web page (.html)', 'One file with the styling and images baked in. Opens in any browser, works offline, prints beautifully.', 'code', async () => {
        toast('Building the page…', { ms: 1200 });
        const html = await toHtml(doc);
        downloadBlob(new Blob([html], { type: 'text/html' }), slug(doc.title) + '.html');
        closeSheet(); toast('Web page saved', { icon: 'download' });
      }),
      opt('Backup (.json)', 'This note with its highlights, notes and flashcards — for moving it to another device.', 'archive', async () => {
        const images = [];
        for (const id of doc.images || []) {
          const url = store.imageURL(id);
          if (!url) continue;
          const blob = await (await fetch(url)).blob();
          const dataUrl = await new Promise(r => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(blob); });
          images.push({ id, dataUrl });
        }
        downloadText(JSON.stringify({ app: 'lucid', version: 1, docs: [doc], images }), slug(doc.title) + '.lucid.json', 'application/json');
        closeSheet(); toast('Backup saved', { icon: 'download' });
      }),
      opt('Print / save as PDF', 'Uses your device’s own print dialog — pick “Save to Files” for a PDF.', 'print', () => { closeSheet(); setTimeout(() => printDoc(doc), 200); }),
      opt('Copy to clipboard', 'The Markdown source, ready to paste back to Claude.', 'copy', () => {
        copyText(doc.markdown).then(ok => { closeSheet(); toast(ok ? 'Copied' : 'Could not copy', { icon: 'copy', kind: ok ? 'ok' : 'err' }); });
      }),
    ),
  });
}

const opt = (title, desc, icon, fn) => el('button', {
  class: 'menu-item', style: { alignItems: 'flex-start', padding: 'var(--gap-3)' }, onclick: fn,
},
  el('span', { class: 'i', dataset: { icon }, style: { marginTop: '.2em' } }),
  el('span', { style: { display: 'block' } },
    el('b', { style: { display: 'block', color: 'var(--ink)', fontWeight: '620' }, text: title }),
    el('span', { style: { display: 'block', marginTop: '2px', color: 'var(--ink-4)', fontSize: 'var(--fs-sm)', lineHeight: '1.45', whiteSpace: 'normal' }, text: desc })),
);

export function printDoc(doc) {
  // the reader is already laid out for print; just make sure it is the visible view
  if (!location.hash.includes(doc.id)) {
    location.hash = `#/reader?id=${doc.id}`;
    setTimeout(() => window.print(), 700);
  } else {
    window.print();
  }
}

/* ---------------- self-contained HTML ---------------- */

async function toHtml(doc) {
  const { blocks, meta } = parse(doc.markdown);
  const dataUrls = new Map();
  for (const id of doc.images || []) {
    const url = store.imageURL(id);
    if (!url) continue;
    try {
      const blob = await (await fetch(url)).blob();
      dataUrls.set(id, await new Promise(r => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(blob); }));
    } catch {}
  }
  const { html } = renderAst(blocks, {
    img: (src) => src.startsWith('img:') ? (dataUrls.get(src.slice(4)) || '') : src,
  });

  const css = await collectCss();
  const root = document.documentElement;
  const attrs = ['theme', 'accent', 'font', 'headings', 'texture', 'paper', 'hlstyle', 'images']
    .map(k => `data-${k}="${escapeHtml(root.dataset[k] || '')}"`).join(' ');
  const vars = root.getAttribute('style') || '';

  const hls = (doc.highlights || []).map(h => ({ ...h }));
  const painted = paintOffline(html, hls);

  return `<!doctype html>
<html lang="en" ${attrs} style="${escapeHtml(vars)}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(doc.title || 'Note')}</title>
<style>${css}
body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--font-ui)}
.wrap{max-width:var(--measure);margin:0 auto;padding:6vh 20px 14vh}
.paper-title{font-family:var(--font-head);font-size:var(--fs-title);font-weight:var(--heading-weight);letter-spacing:-.035em;line-height:1.08;margin:0 0 .4em}
.kick{color:var(--accent);font-size:var(--fs-sm);font-weight:650;letter-spacing:.05em;text-transform:uppercase;margin-bottom:10px}
.meta{color:var(--ink-4);font-size:var(--fs-sm);border-top:1px solid var(--line-soft);padding-top:12px;margin:0 0 42px}
</style>
</head>
<body>
<div class="wrap">
  ${meta.subject || doc.subject ? `<div class="kick">${escapeHtml(doc.emoji || '')} ${escapeHtml(doc.subject || meta.subject)}</div>` : ''}
  <h1 class="paper-title">${escapeHtml(doc.title || 'Note')}</h1>
  <p class="meta">${escapeHtml(new Date(doc.updatedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }))} · exported from Lucid</p>
  <div class="prose">${painted}</div>
</div>
<script>
document.querySelectorAll('.quiz-q').forEach(q => q.addEventListener('click', () => q.closest('.quiz').classList.toggle('is-open')));
<\/script>
</body>
</html>`;
}

/** Re-apply highlights to an HTML string using an offscreen document. */
function paintOffline(html, highlights) {
  const holder = document.createElement('div');
  holder.innerHTML = html;
  if (!highlights.length) return holder.innerHTML;
  // reuse the live painter against the detached tree
  try {
    const mod = window.__lucidHL;
    if (mod) mod.paint(holder, highlights);
  } catch {}
  return holder.innerHTML;
}

let cssCache = null;
async function collectCss() {
  if (cssCache) return cssCache;
  const files = ['tokens.css', 'icons.css', 'base.css', 'components.css', 'reader.css'];
  const parts = [];
  for (const f of files) {
    try {
      const res = await fetch(new URL(`../../styles/${f}`, import.meta.url));
      if (res.ok) parts.push(await res.text());
    } catch {}
  }
  cssCache = parts.join('\n');
  return cssCache;
}
