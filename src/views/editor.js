/* Lucid — editor: source on the left, the real thing on the right. */

import { $, $$, el, debounce, countWords, copyText, clamp } from '../core/util.js';
import * as store from '../core/store.js';
import * as settings from '../core/settings.js';
import { parse, splitFrontmatter, buildFrontmatter, CALLOUTS } from '../parse/lmd.js';
import { render as renderAst } from '../parse/render.js';
import { menu, toast, sheet, lightbox } from '../ui/ui.js';
import { go, back } from '../core/router.js';
import { PROMPT } from '../core/prompt.js';
import { tidy } from '../import/tidy.js';

let doc = null;
let bound = false;
let ta = null;
let actions = {};
let fmSnapshot = '';        // the front matter as it was when we last looked

const fmKey = (md) => {
  const { meta } = splitFrontmatter(md);
  return JSON.stringify([meta.title || '', meta.subject || '', (meta.tags || []).join(','), meta.emoji || '', meta.accent || '']);
};

export function configure(a) { actions = a; }

export const view = {
  async mount({ id }) {
    doc = store.get(id);
    if (!doc) { go('library', {}, { replace: true }); return; }
    bind();
    await store.preloadImages(doc);
    ta.value = doc.markdown;
    fmSnapshot = fmKey(doc.markdown);
    $('#ed-title').value = doc.title === 'Untitled note' ? '' : doc.title;
    $('#ed-subject').value = doc.subject || '';
    $('#ed-tags').value = (doc.tags || []).join(', ');
    $('#ed-emoji').value = doc.emoji || '';
    renderAccents();
    fillSubjects();
    setLayout(settings.get('edLayout'));
    updatePreview();
    setSaved(true);
    // On a desktop, landing in the text ready to type is the point. On a
    // phone the same line throws the keyboard up over half the screen and
    // scrolls to the bottom of the note before you have read a word of it,
    // every time you open the editor. So there, start at the top and wait
    // to be asked.
    requestAnimationFrame(() => {
      if (matchMedia('(pointer: coarse)').matches) { ta.scrollTop = 0; return; }
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
    });
  },
  async unmount() {
    await commit(true);
  },
};

/* ---------------- saving ---------------- */

function setSaved(saved) {
  const s = $('#save-state');
  s.textContent = saved ? 'Saved' : 'Saving…';
  s.classList.toggle('is-saving', !saved);
}

async function commit(final = false) {
  if (!doc) return;
  doc.markdown = ta.value;

  const current = fmKey(doc.markdown);
  if (current !== fmSnapshot) {
    // the source's front matter changed — most likely a fresh paste, so let it win
    store.syncMetaFromMarkdown(doc);
    $('#ed-title').value = doc.title === 'Untitled note' ? '' : doc.title;
    $('#ed-subject').value = doc.subject || '';
    $('#ed-tags').value = (doc.tags || []).join(', ');
    $('#ed-emoji').value = doc.emoji || '';
    renderAccents();
  } else {
    // otherwise the fields are the source of truth
    doc.title = ($('#ed-title').value.trim()) || firstHeading(ta.value) || 'Untitled note';
    doc.subject = $('#ed-subject').value.trim();
    doc.tags = $('#ed-tags').value.split(',').map(s => s.trim()).filter(Boolean);
    doc.emoji = $('#ed-emoji').value.trim();
    // keep existing front matter in step; never add it to a note that has none
    if (/^---[ \t]*\n/.test(doc.markdown)) {
      const before = ta.selectionStart, after = ta.selectionEnd;
      const grown = ta.value.length;
      store.writeFrontmatter(doc);
      if (doc.markdown !== ta.value) {
        const delta = doc.markdown.length - grown;
        ta.value = doc.markdown;
        if (document.activeElement === ta) ta.setSelectionRange(before + delta, after + delta);
      }
    }
  }
  fmSnapshot = fmKey(doc.markdown);

  store.invalidate(doc.id);
  await store.save(doc);
  if (doc.subject) settings.set({ lastSubject: doc.subject }, true);
  setSaved(true);
  if (final) await store.flush();
}

const commitSoon = debounce(() => commit(), 700);

function firstHeading(md) {
  const { meta, body } = splitFrontmatter(md);
  if (meta.title) return meta.title;
  const m = /^#{1,3}\s+(.+)$/m.exec(body);
  if (m) return m[1].trim();
  const p = body.split('\n').find(l => l.trim() && !/^[-*#>|`:]/.test(l.trim()));
  return p ? p.trim().slice(0, 70) : '';
}

/* ---------------- preview ---------------- */

const updatePreview = debounce(() => {
  const src = ta.value;
  const { blocks } = parse(src);
  const { html } = renderAst(blocks, { img: (s) => store.resolveImage(s) });
  $('#ed-prose').innerHTML = html;
  const words = countWords(src.replace(/^---[\s\S]*?---/, ''));
  $('#ed-count').textContent = `${words.toLocaleString()} word${words === 1 ? '' : 's'} · ${src.length.toLocaleString()} characters`;
}, 180);

/* ---------------- insertion helpers ---------------- */

function surround(before, after = '', placeholder = '') {
  const start = ta.selectionStart, end = ta.selectionEnd;
  const sel = ta.value.slice(start, end) || placeholder;
  const text = before + sel + after;
  ta.setRangeText(text, start, end, 'select');
  if (!ta.value.slice(start, start + text.length).includes(placeholder) || !placeholder) {
    ta.setSelectionRange(start + before.length, start + before.length + sel.length);
  } else {
    const p = ta.value.indexOf(placeholder, start);
    ta.setSelectionRange(p, p + placeholder.length);
  }
  ta.focus();
  onInput();
}

function lineStart(pos) {
  const i = ta.value.lastIndexOf('\n', Math.max(0, pos - 1));
  return i + 1;
}

function prefixLines(prefix) {
  const start = lineStart(ta.selectionStart);
  let end = ta.value.indexOf('\n', ta.selectionEnd);
  if (end < 0) end = ta.value.length;
  const chunk = ta.value.slice(start, end);
  const lines = chunk.split('\n');
  const allHave = lines.every(l => !l.trim() || l.startsWith(prefix));
  const next = lines.map((l, i) => {
    if (!l.trim()) return l;
    if (allHave) return l.slice(prefix.length);
    if (/^\d+\.\s/.test(prefix)) return `${i + 1}. ` + l.replace(/^(\s*(?:[-*+]|\d+[.)])\s+)/, '');
    return prefix + l.replace(/^(\s*(?:[-*+]|\d+[.)])\s+)/, '');
  }).join('\n');
  ta.setRangeText(next, start, end, 'select');
  ta.focus();
  onInput();
}

function insertBlock(text) {
  const pos = ta.selectionStart;
  const before = ta.value.slice(0, pos);
  const needsNl = before && !before.endsWith('\n\n') ? (before.endsWith('\n') ? '\n' : '\n\n') : '';
  const body = needsNl + text + '\n\n';
  ta.setRangeText(body, pos, ta.selectionEnd, 'end');
  const cursorMark = body.indexOf('⟨');
  if (cursorMark >= 0) {
    const abs = pos + cursorMark;
    ta.setRangeText('', abs, abs + 1, 'end');
    const close = ta.value.indexOf('⟩', abs);
    if (close >= 0) { ta.setRangeText('', close, close + 1, 'end'); ta.setSelectionRange(abs, close); }
    else ta.setSelectionRange(abs, abs);
  }
  ta.focus();
  onInput();
}

function onInput() {
  setSaved(false);
  updatePreview();
  commitSoon();
}

/* ---------------- images ---------------- */

async function insertImage(file) {
  if (!file || !/^image\//.test(file.type)) return false;
  const { ref } = await store.addImage(file, doc.id);
  const name = (file.name || 'image').replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');
  insertBlock(`![⟨${name}⟩](${ref})`);
  await commit();
  toast('Image added', { icon: 'image' });
  return true;
}

/* ---------------- toolbar ---------------- */

const TOOLS = [
  { icon: 'hash', label: 'Heading', fn: () => prefixLines('## ') },
  { icon: 'type', label: 'Bold', title: 'Bold (⌘B)', fn: () => surround('**', '**', 'bold text') },
  { icon: 'quote', label: 'Italic', title: 'Italic (⌘I)', fn: () => surround('*', '*', 'italic text') },
  { icon: 'marker', label: 'Mark', title: 'Highlight (⌘H)', fn: () => surround('==', '==', 'important') },
  { sep: true },
  { icon: 'list', label: 'Bullets', fn: () => prefixLines('- ') },
  { icon: 'list', label: '1, 2, 3', fn: () => prefixLines('1. ') },
  { icon: 'check', label: 'Checklist', fn: () => prefixLines('- [ ] ') },
  { icon: 'quote', label: 'Quote', fn: () => prefixLines('> ') },
  { sep: true },
  { icon: 'star', label: 'Callout', fn: (e) => calloutMenu(e.currentTarget) },
  { icon: 'help', label: 'Quiz', fn: () => insertBlock('::: quiz\nQ: ⟨Your question⟩\nA: The answer.\n:::') },
  { icon: 'table', label: 'Table', fn: () => insertBlock('| ⟨Column⟩ | Column |\n| --- | --- |\n| Value | Value |') },
  { icon: 'code', label: 'Code', fn: () => insertBlock('```\n⟨code⟩\n```') },
  { icon: 'image', label: 'Image', fn: () => pickImage() },
  { icon: 'layout', label: 'Divider', fn: () => insertBlock('---') },
  { sep: true },
  { icon: 'wand', label: 'Tidy up', title: 'Clean up pasted text', fn: () => tidyCurrent() },
  { icon: 'sparkle', label: 'AI prompt', cls: 'accent', title: 'Copy the prompt that makes Claude write in this format', fn: () => copyPrompt() },
];

function buildToolbar() {
  const bar = $('#ed-toolbar');
  bar.innerHTML = '';
  for (const t of TOOLS) {
    if (t.sep) { bar.append(el('span', { class: 'tb-sep' })); continue; }
    bar.append(el('button', {
      class: 'tb-btn' + (t.cls ? ' ' + t.cls : ''), title: t.title || t.label,
      onmousedown: (e) => e.preventDefault(),
      onclick: t.fn,
    }, el('span', { class: 'i', dataset: { icon: t.icon } }), el('span', { text: t.label })));
  }
}

function calloutMenu(anchor) {
  const items = Object.entries(CALLOUTS)
    .filter(([k]) => !['quiz', 'compare', 'steps'].includes(k))
    .map(([k, v]) => ({
      label: v.label, icon: v.icon,
      fn: () => insertBlock(`::: ${k}\n⟨Write it here⟩\n:::`),
    }));
  items.push('-');
  items.push({ label: 'Steps', icon: 'list', fn: () => insertBlock('::: steps ⟨How it happens⟩\n- First\n- Then\n- Finally\n:::') });
  items.push({ label: 'Compare two things', icon: 'table', fn: () => insertBlock('::: compare ⟨This⟩ vs That\n- point\n|||\n- point\n:::') });
  menu(items, { anchor, align: 'start' });
}

function pickImage() {
  const input = el('input', { type: 'file', accept: 'image/*', style: { display: 'none' } });
  input.addEventListener('change', async () => {
    for (const f of input.files) await insertImage(f);
    input.remove();
  });
  document.body.append(input);
  input.click();
}

function copyPrompt() {
  copyText(PROMPT).then(ok => {
    toast(ok ? 'Prompt copied — paste it to Claude above your lecture material' : 'Could not copy', {
      icon: 'sparkle', kind: ok ? 'ok' : 'err', ms: 4200,
      action: { label: 'See guide', fn: () => go('guide') },
    });
  });
}

function tidyCurrent() {
  const before = ta.value;
  const { meta, body } = splitFrontmatter(before);
  const cleaned = tidy(body, {
    unwrap: true, hyphen: true, headings: true, bullets: true,
    furniture: true, quotes: true, callouts: true, quiz: true,
  });
  if (cleaned.trim() === body.trim()) { toast('Already tidy', { icon: 'check' }); return; }
  ta.value = buildFrontmatter(meta) + cleaned;
  onInput();
  toast('Cleaned up', { icon: 'wand', action: { label: 'Undo', fn: () => { ta.value = before; onInput(); } } });
}

/* ---------------- accents & subjects ---------------- */

function renderAccents() {
  const wrap = $('#ed-accents');
  wrap.innerHTML = '';
  wrap.append(el('button', {
    class: 'accent-dot' + (!doc.accent ? ' is-on' : ''), style: { '--c': 'var(--ink-4)' }, title: 'Default',
    onclick: () => { doc.accent = null; renderAccents(); commitSoon(); document.documentElement.dataset.accent = settings.get('accent'); },
  }));
  for (const a of settings.ACCENTS) {
    wrap.append(el('button', {
      class: 'accent-dot' + (doc.accent === a.id ? ' is-on' : ''), style: { '--c': a.c }, title: a.name,
      onclick: () => { doc.accent = a.id; renderAccents(); commitSoon(); document.documentElement.dataset.accent = a.id; },
    }));
  }
}

function fillSubjects() {
  const dl = $('#subject-list');
  dl.innerHTML = '';
  store.subjects().forEach(s => dl.append(el('option', { value: s.name })));
}

/* ---------------- layout ---------------- */

function setLayout(mode) {
  $('#ed-shell').dataset.layout = mode;
  $$('.seg-btn[data-edlayout]').forEach(b => b.classList.toggle('is-on', b.dataset.edlayout === mode));
  settings.set({ edLayout: mode }, true);
}

function bindResizer() {
  const rez = $('#ed-resizer'), shell = $('#ed-shell');
  let dragging = false;
  const move = (e) => {
    if (!dragging) return;
    const r = shell.getBoundingClientRect();
    const x = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
    const frac = clamp(x / r.width, 0.22, 0.78);
    const ratio = frac / (1 - frac);
    document.documentElement.style.setProperty('--ed-split', ratio.toFixed(3) + 'fr');
    settings.set({ edSplit: +ratio.toFixed(3) }, true);
  };
  const stop = () => { dragging = false; rez.classList.remove('is-drag'); document.body.style.userSelect = ''; };
  rez.addEventListener('pointerdown', (e) => { dragging = true; rez.classList.add('is-drag'); document.body.style.userSelect = 'none'; rez.setPointerCapture(e.pointerId); });
  rez.addEventListener('pointermove', move);
  rez.addEventListener('pointerup', stop);
  rez.addEventListener('pointercancel', stop);
  rez.addEventListener('dblclick', () => { document.documentElement.style.setProperty('--ed-split', '1fr'); settings.set({ edSplit: 1 }, true); });
}

/* ---------------- wiring ---------------- */

function bind() {
  if (bound) return;
  bound = true;
  ta = $('#ed-source');
  buildToolbar();
  bindResizer();

  ta.addEventListener('input', onInput);
  ta.addEventListener('keydown', (e) => {
    const cmd = e.metaKey || e.ctrlKey;
    if (cmd && e.key.toLowerCase() === 'b') { e.preventDefault(); surround('**', '**', 'bold text'); }
    else if (cmd && e.key.toLowerCase() === 'i') { e.preventDefault(); surround('*', '*', 'italic text'); }
    else if (cmd && e.key.toLowerCase() === 'h') { e.preventDefault(); surround('==', '==', 'important'); }
    else if (cmd && e.key.toLowerCase() === 'k') { /* palette handles it */ }
    else if (cmd && e.key === 's') { e.preventDefault(); commit(true).then(() => toast('Saved', { icon: 'save' })); }
    else if (e.key === 'Tab') {
      e.preventDefault();
      if (e.shiftKey) prefixLines('  ');
      else { const p = ta.selectionStart; ta.setRangeText('  ', p, ta.selectionEnd, 'end'); onInput(); }
    } else if (e.key === 'Enter') {
      // continue lists
      const start = lineStart(ta.selectionStart);
      const line = ta.value.slice(start, ta.selectionStart);
      const m = /^(\s*)([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?/.exec(line);
      if (m && line.trim() !== m[0].trim()) {
        e.preventDefault();
        const bullet = /\d/.test(m[2]) ? `${parseInt(m[2]) + 1}.` : m[2];
        const task = m[3] ? '[ ] ' : '';
        const ins = `\n${m[1]}${bullet} ${task}`;
        ta.setRangeText(ins, ta.selectionStart, ta.selectionEnd, 'end');
        onInput();
      } else if (m) {
        e.preventDefault();
        ta.setRangeText('\n', start, ta.selectionEnd, 'end');
        onInput();
      }
    }
  });

  ta.addEventListener('paste', async (e) => {
    const items = Array.from(e.clipboardData?.items || []);
    const imgItem = items.find(i => i.type.startsWith('image/'));
    if (imgItem) {
      e.preventDefault();
      await insertImage(imgItem.getAsFile());
      return;
    }
    const text = e.clipboardData?.getData('text/plain') || '';
    if (text.length > 600 && !ta.value.trim()) {
      // big paste into an empty note: offer a clean-up
      setTimeout(() => {
        toast('Pasted. Want it tidied up?', {
          icon: 'wand', ms: 6000,
          action: { label: 'Tidy', fn: tidyCurrent },
        });
      }, 300);
    }
  });

  ['dragenter', 'dragover'].forEach(t => ta.addEventListener(t, (e) => { e.preventDefault(); ta.parentElement.classList.add('is-drop'); }));
  ['dragleave', 'drop'].forEach(t => ta.addEventListener(t, (e) => { e.preventDefault(); ta.parentElement.classList.remove('is-drop'); }));
  ta.addEventListener('drop', async (e) => {
    const files = Array.from(e.dataTransfer?.files || []);
    for (const f of files) if (f.type.startsWith('image/')) await insertImage(f);
  });

  ['#ed-title', '#ed-subject', '#ed-tags', '#ed-emoji'].forEach(sel =>
    $(sel).addEventListener('input', () => { setSaved(false); commitSoon(); }));

  $$('.seg-btn[data-edlayout]').forEach(b => b.addEventListener('click', () => setLayout(b.dataset.edlayout)));

  $('.view-editor .doc-bar').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    if (b.dataset.act === 'editor-back' || b.dataset.act === 'editor-done') {
      commit(true).then(() => go('reader', { id: doc.id }));
    }
    if (b.dataset.act === 'ed-guide') go('guide');
  });

  $('#ed-prose').addEventListener('click', (e) => {
    const img = e.target.closest('img[data-zoom]');
    if (img) lightbox(img.src, img.alt || '');
    const q = e.target.closest('.quiz-q');
    if (q) q.closest('.quiz').classList.toggle('is-open');
  });
}

export const keys = {
  save: () => commit(true).then(() => toast('Saved', { icon: 'save' })),
  done: () => commit(true).then(() => go('reader', { id: doc.id })),
  layout: setLayout,
};
