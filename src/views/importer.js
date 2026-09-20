/* Lucid — import view: files in, readable notes out. */

import { $, $$, el, readFileText, readFileBuffer, fmtBytes, debounce } from '../core/util.js';
import * as store from '../core/store.js';
import * as settings from '../core/settings.js';
import { parse, buildFrontmatter, splitFrontmatter } from '../parse/lmd.js';
import { render as renderAst } from '../parse/render.js';
import { tidy, guessTitle, guessSubject } from '../import/tidy.js';
import { toast, lightbox, confirmDialog, closeSheet } from '../ui/ui.js';
import { go } from '../core/router.js';
import * as ai from '../core/ai.js';

let bound = false;
let job = null;       // { name, raw, images:[{blob,url}], kind, meta }
let lastFile = null;  // kept so changing an option can re-read the same file
let aiBefore = null;  // the markdown as it was before the model touched it
let aiRun = null;     // AbortController for a rewrite in flight
let tab = 'preview';

let actions = {};
export function configure(a) { actions = a; }

export const view = {
  async mount() {
    bind();
    if (!job) resetUI();
    else showResult();
  },
  async unmount() { /* keep the job so going back doesn't lose work */ },
};

/* ---------------- ui state ---------------- */

function resetUI() {
  $('#import-opts').hidden = true;
  $('#import-status').hidden = true;
  $('#import-preview-head').hidden = true;
  $('#import-create').disabled = true;
  $('#import-preview').innerHTML = '<div class="import-placeholder"><p>Your cleaned-up note will appear here.</p></div>';
  $('#import-source').hidden = true;
}

function status(text, pct) {
  const wrap = $('#import-status');
  wrap.hidden = false;
  $('#import-status-text').textContent = text;
  $('#import-bar').style.width = (pct == null ? 100 : Math.round(pct * 100)) + '%';
}

const opts = () => ({
  unwrap: $('#opt-unwrap').checked,
  hyphen: $('#opt-hyphen').checked,
  headings: $('#opt-headings').checked,
  bullets: $('#opt-bullets').checked,
  furniture: $('#opt-furniture').checked,
  quotes: $('#opt-quotes').checked,
  callouts: $('#opt-callouts').checked,
  quiz: $('#opt-quiz').checked,
  images: $('#opt-images').checked,
  pdfImages: $('#opt-pdf-images .opt-btn.is-on')?.dataset.pdfimg || 'none',
  notes: $('#opt-notes').checked,
});

/* ---------------- file handling ---------------- */

async function handleFiles(files) {
  const list = Array.from(files);
  if (!list.length) return;
  if (list.length === 1) { await runOne(list[0]); return; }

  // several files: import them all straight into the library
  let made = 0;
  for (let i = 0; i < list.length; i++) {
    status(`Importing ${i + 1} of ${list.length}: ${list[i].name}`, i / list.length);
    try {
      await runOne(list[i], { silent: true });
      await createNote({ silent: true });
      made++;
    } catch (e) {
      console.error(e);
      toast(`Could not read ${list[i].name}`, { kind: 'err', icon: 'help' });
    }
  }
  status(`Imported ${made} files`, 1);
  toast(`${made} notes created`, { icon: 'check' });
  go('library');
}

/** The formats where the extracted text is worth a model's attention. */
const WORTH_REWRITING = new Set(['pdf', 'pptx', 'docx']);

async function runOne(file, { silent = false, auto = true } = {}) {
  lastFile = file;
  aiBefore = null;
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  job = { name: file.name, kind: ext, images: [], meta: {}, raw: '', aiMarkdown: null };
  const o = opts();

  const onProgress = (n, total, label) => { if (!silent) status(label, total ? n / total : null); };

  try {
    if (ext === 'pdf') {
      if (!silent) status('Opening PDF…', 0.02);
      const { importPdf } = await import('../import/pdf.js');
      const buf = await readFileBuffer(file);
      const res = await importPdf(buf, { images: o.pdfImages, onProgress });
      job.raw = res.markdown;
      job.images = res.images.map(i => i.blob);
      job.meta = { title: res.title, pages: res.pageCount, scanned: res.scanned };
      job.meta.slideLike = res.slideLike;
      if (res.scanned && o.pdfImages !== 'all') {
        toast('This PDF looks like a scan — set Pictures from PDFs to “Every page” to bring it in as images', { kind: 'warn', icon: 'help', ms: 7000 });
      }
    } else if (ext === 'pptx') {
      if (!silent) status('Opening presentation…', 0.02);
      const { importPptx } = await import('../import/office.js');
      const res = await importPptx(await readFileBuffer(file), { images: o.images, notes: o.notes, onProgress });
      job.raw = res.markdown;
      job.images = res.images.map(i => i.blob);
      job.meta = { title: res.title, slides: res.slideCount };
    } else if (ext === 'docx') {
      if (!silent) status('Opening document…', 0.02);
      const { importDocx } = await import('../import/office.js');
      const res = await importDocx(await readFileBuffer(file), { images: o.images, onProgress });
      job.raw = res.markdown;
      job.images = res.images.map(i => i.blob);
      job.meta = { title: res.title };
    } else if (['md', 'markdown', 'txt', 'text'].includes(ext)) {
      job.raw = await readFileText(file);
      job.meta = { plain: true };
    } else if (['html', 'htm'].includes(ext)) {
      job.raw = htmlToMarkdown(await readFileText(file));
      job.meta = {};
    } else if (file.type.startsWith('image/')) {
      job.images = [file];
      job.raw = `## ${file.name.replace(/\.[^.]+$/, '')}\n\n![${file.name}](IMG:0)\n`;
      job.meta = { plain: true };
    } else {
      throw new Error('Unsupported file type');
    }
  } catch (e) {
    console.error(e);
    status('Could not read that file', 1);
    toast(e.message || 'Could not read that file', { kind: 'err', icon: 'help', ms: 5000 });
    job = null;
    throw e;
  }

  job.urls = job.images.map(b => URL.createObjectURL(b));
  job.fileSize = file.size;
  if (!silent) { status(`Read ${fmtBytes(file.size)}`, 1); setTimeout(() => { $('#import-status').hidden = true; }, 900); showResult(); }

  // Getting a badly set handout into shape is the whole point, so when there
  // is a key to do it with, do it — rather than leaving a button to find.
  if (!silent && auto && settings.get('aiAuto') && ai.hasKey() && WORTH_REWRITING.has(ext)) {
    aiRewrite({ auto: true });
  }
}

/* ---------------- preview ---------------- */

function composed({ ai: useAi = true } = {}) {
  const o = opts();
  if (useAi && job.aiMarkdown) {
    const { meta } = splitFrontmatter(job.aiMarkdown);
    return { markdown: job.aiMarkdown, title: meta.title || '', subject: meta.subject || '' };
  }
  const isPlain = job.meta.plain && /^---\s*\n/.test(job.raw);
  const { meta, body } = splitFrontmatter(job.raw);
  let cleaned = job.meta.plain && isPlain ? body : tidy(body, o);
  const title = meta.title || job.meta.title || guessTitle(cleaned, job.name.replace(/\.[^.]+$/, ''));
  cleaned = dropLeadingTitle(cleaned, title);
  const subject = meta.subject || settings.get('lastSubject') || guessSubject(job.name);
  const fm = buildFrontmatter({
    title,
    subject,
    tags: meta.tags || [],
    emoji: meta.emoji || iconFor(job.kind),
    accent: meta.accent || null,
  });
  return { markdown: fm + cleaned.replace(/^\n+/, ''), title, subject };
}

/** The first heading often just repeats the document title — drop it. */
function dropLeadingTitle(md, title) {
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const lines = md.split('\n');
  for (let i = 0; i < Math.min(4, lines.length); i++) {
    const l = lines[i].trim();
    if (!l) continue;
    const m = /^#{1,4}\s+(.+)$/.exec(l);
    if (!m) break;
    if (norm(m[1]) === norm(title)) { lines.splice(i, 1); break; }
    break;
  }
  return lines.join('\n').replace(/^\n+/, '');
}

const iconFor = (kind) => ({ pdf: '📕', pptx: '📊', docx: '📄', md: '📝', txt: '📝' }[kind] || '📘');

function showResult() {
  if (!job) return;
  $('#import-opts').hidden = false;
  refreshAi();
  $('#import-preview-head').hidden = false;
  $('#import-create').disabled = false;

  const { markdown } = composed();
  const bits = [job.name, job.meta.pages ? `${job.meta.pages} pages` : null, job.meta.slides ? `${job.meta.slides} slides` : null,
                job.images.length ? `${job.images.length} images` : null, fmtBytes(job.fileSize || 0)].filter(Boolean);
  $('#import-meta').textContent = bits.join(' · ');

  $('#import-source').value = markdown;
  const { blocks } = parse(markdown);
  const { html } = renderAst(blocks, { img: (s) => resolvePreview(s) });
  $('#import-preview').innerHTML =
    `<article class="paper paper-preview"><div class="prose">${html}</div></article>`;

  $('#import-preview').hidden = tab !== 'preview';
  $('#import-source').hidden = tab !== 'source';
}

const resolvePreview = (src) => {
  const m = /^IMG:(\d+)$/.exec(src);
  if (m) return job.urls[+m[1]] || '';
  return store.resolveImage(src);
};

/* ---------------- AI clean-up ---------------- */

function refreshAi() {
  const ready = ai.hasKey();
  $('#ai-setup').hidden = ready;
  $('#ai-rewrite').hidden = !ready;
  $('#ai-undo').hidden = !job?.aiMarkdown;
  $('#ai-auto-row').hidden = !ready;
  $('#opt-ai-auto').checked = settings.get('aiAuto') !== false;
  $('#ai-rewrite-label').textContent = job?.aiMarkdown ? 'Rewrite again' : 'Rewrite with AI';
  $('#ai-blurb').textContent = ready
    ? 'Gemini skims the whole document first to work out what it is and how it is laid out, then rewrites it a piece at a time with that plan in hand — so headings, lists and definitions come out consistent from end to end. Only text is sent, never pictures.'
    : 'Lucid can have Gemini restructure the extracted text for you. It needs your own free key, kept on this device.';
}

async function aiRewrite({ auto = false } = {}) {
  if (!job) return;
  if (!ai.hasKey()) { if (!auto) actions.openAppearance?.('data'); return; }
  if (aiRun) return;

  // "Rewrite again" means have another go at the document, not rewrite the
  // rewrite: feeding an answer back in compounds whatever it got wrong. The
  // extracted text is the source unless you have edited it by hand.
  const edited = tab === 'source' && $('#import-source').value.trim();
  const source = edited && edited !== composed().markdown.trim()
    ? $('#import-source').value
    : composed({ ai: false }).markdown;

  aiBefore = job.aiMarkdown || null;
  aiRun = new AbortController();

  const wrap = $('#ai-progress');
  wrap.hidden = false;
  $('#ai-rewrite').disabled = true;

  try {
    const markdown = await ai.restructure(source, {
      signal: aiRun.signal,
      onProgress: (done, total, label) => {
        $('#ai-bar').style.width = `${Math.round((done / Math.max(1, total)) * 100)}%`;
        $('#ai-status').textContent = label;
      },
    });
    job.aiMarkdown = markdown;
    showResult();
    toast(auto ? 'Tidied up with Gemini' : 'Rewritten', { icon: 'sparkle' });
  } catch (e) {
    if (e.name === 'AbortError') return;
    console.error(e);
    const why = e instanceof ai.AiError ? e.message : 'Something went wrong talking to Gemini.';
    toast(why, { kind: 'err', icon: 'help', ms: 7000,
      action: e?.kind === 'key' || e?.kind === 'no-key' ? { label: 'Settings', fn: () => actions.openAppearance?.('data') } : undefined });
  } finally {
    wrap.hidden = true;
    $('#ai-bar').style.width = '0%';
    $('#ai-rewrite').disabled = false;
    aiRun = null;
  }
}

function aiUndo() {
  if (!job) return;
  job.aiMarkdown = aiBefore || null;
  aiBefore = null;
  showResult();
  toast('Reverted to the extracted text', { icon: 'back' });
}

/* ---------------- create ---------------- */

async function createNote({ silent = false, force = false } = {}) {
  if (!job) return;
  const useSource = tab === 'source' && $('#import-source').value.trim();
  let markdown = useSource ? $('#import-source').value : composed().markdown;
  const { meta } = splitFrontmatter(markdown);

  if (!force && !silent) {
    const existing = store.findDuplicate(markdown);
    if (existing) {
      confirmDialog({
        title: 'You have imported this before',
        message: `“${existing.title}” came from the same material. Open it instead of importing a second copy?`,
        confirmLabel: 'Open the one I have',
        onConfirm: () => { job = null; resetUI(); go('reader', { id: existing.id }); },
      });
      const cancel = $('#sheet-foot')?.querySelector('.btn-outline');
      if (cancel) { cancel.textContent = 'Import anyway'; cancel.onclick = () => { closeSheet(); createNote({ force: true }); }; }
      return;
    }
  }

  const doc = await store.create({
    title: meta.title || 'Imported note',
    subject: meta.subject || '',
    tags: meta.tags || [],
    emoji: meta.emoji || iconFor(job.kind),
    accent: meta.accent || null,
    source: job.kind,
    markdown: '',
  });

  // persist only the images the note actually uses
  const used = new Set(Array.from(markdown.matchAll(/IMG:(\d+)/g)).map(m => +m[1]));
  for (const idx of used) {
    const blob = job.images[idx];
    if (!blob) { markdown = markdown.replace(new RegExp(`!\\[[^\\]]*\\]\\(IMG:${idx}\\)\\n?`, 'g'), ''); continue; }
    const { ref } = await store.addImage(blob, doc.id);
    markdown = markdown.split(`IMG:${idx})`).join(`${ref})`);
  }
  doc.markdown = markdown;
  await store.save(doc);

  job.urls?.forEach(u => URL.revokeObjectURL(u));
  job = null;
  if (!silent) {
    resetUI();
    toast('Note created', { icon: 'check' });
    go('reader', { id: doc.id });
  }
  return doc;
}

/* ---------------- html → markdown (for saved web pages) ---------------- */

function htmlToMarkdown(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script,style,nav,footer,header,aside,noscript,svg,form').forEach(n => n.remove());
  const root = doc.querySelector('article, main, [role="main"]') || doc.body;
  const out = [];
  const walk = (node, depth = 0) => {
    for (const child of node.children) {
      const tag = child.tagName.toLowerCase();
      const text = child.textContent.replace(/\s+/g, ' ').trim();
      if (/^h[1-6]$/.test(tag)) { out.push('', '#'.repeat(Math.min(4, +tag[1] + 1)) + ' ' + text, ''); }
      else if (tag === 'p') { if (text) out.push(text, ''); }
      else if (tag === 'li') { out.push('  '.repeat(depth) + '- ' + text); }
      else if (tag === 'ul' || tag === 'ol') { walk(child, depth + (node.tagName === 'LI' ? 1 : 0)); out.push(''); }
      else if (tag === 'blockquote') { out.push('> ' + text, ''); }
      else if (tag === 'pre') { out.push('```', child.textContent.trim(), '```', ''); }
      else if (tag === 'table') { out.push(text, ''); }
      else walk(child, depth);
    }
  };
  walk(root);
  const title = doc.querySelector('title')?.textContent?.trim();
  return (title ? `## ${title}\n\n` : '') + out.join('\n');
}

/* ---------------- wiring ---------------- */

function bind() {
  if (bound) return;
  bound = true;

  const dz = $('#dropzone');
  const input = $('#file-input');
  dz.addEventListener('click', () => input.click());
  dz.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
  input.addEventListener('change', () => { handleFiles(input.files); input.value = ''; });

  ['dragenter', 'dragover'].forEach(t => dz.addEventListener(t, (e) => { e.preventDefault(); dz.classList.add('is-over'); }));
  ['dragleave', 'drop'].forEach(t => dz.addEventListener(t, (e) => { e.preventDefault(); dz.classList.remove('is-over'); }));
  dz.addEventListener('drop', (e) => handleFiles(e.dataTransfer.files));

  // dropping anywhere on the import screen works too
  const v = $('.view-import');
  ['dragover'].forEach(t => v.addEventListener(t, (e) => e.preventDefault()));
  v.addEventListener('drop', (e) => { e.preventDefault(); if (!e.target.closest('#dropzone')) handleFiles(e.dataTransfer.files); });

  $$('#import-opts input[type="checkbox"]').forEach(c =>
    c.addEventListener('change', debounce(() => { if (job) showResult(); }, 120)));

  $('#opt-ai-auto').addEventListener('change', (e) => settings.set({ aiAuto: e.target.checked }));

  // the picture choice changes how the file is read, so it needs a re-parse
  $('#opt-pdf-images').addEventListener('click', (e) => {
    const b = e.target.closest('.opt-btn');
    if (!b) return;
    $$('#opt-pdf-images .opt-btn').forEach(x => x.classList.toggle('is-on', x === b));
    if (lastFile) runOne(lastFile, { auto: false });
  });

  $('.view-import .doc-bar').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    if (b.dataset.act === 'import-create') createNote();
    if (b.dataset.act === 'back') go('library');
  });

  $('#import-opts').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'import-reparse') {
      if (!job) { toast('Add a file first', { kind: 'warn', icon: 'help' }); return; }
      job.aiMarkdown = null;
      showResult();
      toast('Clean-up re-run', { icon: 'refresh' });
    }
    if (act === 'ai-rewrite') aiRewrite();
    if (act === 'ai-undo') aiUndo();
    if (act === 'ai-setup') actions.openAppearance?.('data');
  });

  $$('.seg-btn[data-imptab]').forEach(b => b.addEventListener('click', () => {
    tab = b.dataset.imptab;
    $$('.seg-btn[data-imptab]').forEach(x => x.classList.toggle('is-on', x === b));
    $('#import-preview').hidden = tab !== 'preview';
    $('#import-source').hidden = tab !== 'source';
    if (tab === 'preview' && job) showResult();
  }));

  $('#import-source').addEventListener('input', debounce(() => { /* kept as-is until Create */ }, 200));

  $('#import-preview').addEventListener('click', (e) => {
    const img = e.target.closest('img');
    if (img) lightbox(img.src, img.alt || '');
  });
}

export const openWithFiles = (files) => { go('import'); setTimeout(() => handleFiles(files), 60); };
