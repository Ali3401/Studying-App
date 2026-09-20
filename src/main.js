/* Lucid — bootstrap: settings, store, views, shortcuts. */

import { $, $$, el, copyText, isApple } from './core/util.js';
import * as settings from './core/settings.js';
import * as store from './core/store.js';
import * as router from './core/router.js';
import * as HL from './core/highlights.js';
import { toast, closeSheet, closeMenu, closeLightbox, sheetOpen, confirmDialog } from './ui/ui.js';
import * as palette from './ui/palette.js';
import { openAppearance, shortcutsSheet } from './ui/appearance.js';
import { exportDoc, printDoc } from './ui/exporter.js';
import * as library from './views/library.js';
import * as reader from './views/reader.js';
import * as editor from './views/editor.js';
import * as study from './views/study.js';
import * as importer from './views/importer.js';
import * as guide from './views/guide.js';
import { WELCOME } from './core/sample.js';
import * as safety from './core/safety.js';

window.__lucidHL = HL;   // used by the offline HTML exporter

/* ---------------- boot ---------------- */

async function boot() {
  settings.load();
  settings.apply();

  const n = await store.init();
  if (!n && !settings.get('seenWelcome')) {
    await store.create({
      title: 'Start here', subject: 'Lucid', emoji: '✨', accent: 'indigo',
      tags: ['guide'], markdown: WELCOME, source: 'sample',
    });
    settings.set({ seenWelcome: true }, true);
  }

  const shared = { exportDoc, printDoc, openAppearance };
  library.configure(shared);
  reader.configure(shared);
  editor.configure(shared);

  router.register('library', library.view);
  router.register('reader', reader.view);
  router.register('editor', editor.view);
  router.register('study', study.view);
  router.register('import', importer.view);
  router.register('guide', guide.view);

  palette.setCommands(commands());
  palette.setDynamicCommands(subjectCommands);
  wireGlobal();
  wireShortcuts();

  await router.start();

  $('#app').hidden = false;
  const splash = $('#boot');
  splash.classList.add('is-gone');
  setTimeout(() => splash.remove(), 400);

  registerSW();
  safety.requestPersistence();
  setTimeout(offerBackupIfDue, 3500);
}

/* ---------------- global actions ---------------- */

async function newNote() {
  const doc = await store.create({
    title: 'Untitled note',
    subject: settings.get('lastSubject') || '',
    markdown: '',
  });
  router.go('editor', { id: doc.id });
}

function commands() {
  const m = isApple() ? '⌘' : 'Ctrl';
  return [
    { label: 'New note', icon: 'plus', sub: `${m}N`, keywords: 'create paste add write', fn: () => { palette.close(); newNote(); } },
    { label: 'Import a PDF, PowerPoint or Word file', icon: 'upload', sub: `${m}I`, keywords: 'pdf pptx docx slides open file', fn: () => { palette.close(); router.go('import'); } },
    { label: 'Copy the prompt for Claude', icon: 'sparkle', keywords: 'ai format guide claude prompt', fn: async () => {
        palette.close();
        const { PROMPT } = await import('./core/prompt.js');
        const ok = await copyText(PROMPT);
        toast(ok ? 'Prompt copied — paste it above your lecture material' : 'Could not copy', { icon: 'sparkle', kind: ok ? 'ok' : 'err', ms: 4000 });
      } },
    { label: 'Writing & AI format guide', icon: 'help', keywords: 'syntax blocks callouts help how', fn: () => { palette.close(); router.go('guide'); } },
    { label: 'Study everything due', icon: 'cards', keywords: 'flashcards revise review srs', fn: () => { palette.close(); router.go('study'); } },
    { label: 'Appearance', icon: 'sliders', sub: `${m},`, keywords: 'theme font size dark light colour design', fn: () => { palette.close(); openAppearance(); } },
    { label: 'Switch theme', icon: 'moon', keywords: 'dark light sepia midnight paper', fn: () => { palette.close(); cycleTheme(); } },
    { label: 'Keyboard shortcuts', icon: 'keyboard', sub: '?', keywords: 'keys hotkeys', fn: () => { palette.close(); shortcutsSheet(); } },
    { label: 'Library', icon: 'grid', keywords: 'home notes all', fn: () => { palette.close(); router.go('library'); } },
    { label: 'Export a backup of everything', icon: 'download', keywords: 'backup save json export', fn: () => { palette.close(); openAppearance('data'); } },
  ];
}

/** One "Study <subject>" entry per subject that has cards waiting. */
function subjectCommands() {
  return study.dueBySubject().map(({ name, due }) => ({
    label: `Study ${name}`,
    icon: 'cards',
    sub: `${due} due`,
    keywords: 'revise flashcards subject ' + name,
    fn: () => { palette.close(); router.go('study', { subject: name }); },
  }));
}

function cycleTheme() {
  const ids = settings.THEMES.map(t => t.id);
  const i = ids.indexOf(settings.get('theme'));
  const next = ids[(i + 1) % ids.length];
  settings.set({ theme: next, autoTheme: false });
  toast(settings.THEMES.find(t => t.id === next).name, { icon: 'moon', ms: 1200 });
}

/* ---------------- wiring ---------------- */

function wireGlobal() {
  document.body.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'new-paste') newNote();
    else if (act === 'open-import') router.go('import');
    else if (act === 'open-settings' || act === 'appearance') openAppearance();
    else if (act === 'open-guide') router.go('guide');
    else if (act === 'open-search') palette.show();
    else if (act === 'open-study-all') { const s = library.currentSubject(); router.go('study', s ? { subject: s } : {}); }
    else if (act === 'sheet-close') closeSheet();
    else if (act === 'lightbox-close') closeLightbox();
    else if (act === 'load-sample') loadSample();
  });

  $('#lightbox').addEventListener('click', (e) => { if (e.target.id === 'lightbox' || e.target.tagName === 'IMG') closeLightbox(); });

  // files dropped anywhere land in the importer
  addEventListener('dragover', (e) => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); });
  addEventListener('drop', (e) => {
    if (!e.dataTransfer?.files?.length) return;
    if (e.target.closest('.view-import') || e.target.closest('#ed-source')) return;
    e.preventDefault();
    importer.openWithFiles(e.dataTransfer.files);
  });

  // pasting a wall of text into the library makes a note out of it
  addEventListener('paste', async (e) => {
    if (!$('.view-library') || $('.view-library').hidden) return;
    const t = e.target;
    if (t && typeof t.closest === 'function' && t.closest('input, textarea, [contenteditable]')) return;
    const text = e.clipboardData?.getData('text/plain') || '';
    if (text.trim().length < 40) return;
    e.preventDefault();

    const existing = store.findDuplicate(text);
    if (existing) {
      confirmDialog({
        title: 'You already have this',
        message: `“${existing.title}” starts with the same text and is about the same length. Open it instead of making a second copy?`,
        confirmLabel: 'Open the one I have',
        onConfirm: () => router.go('reader', { id: existing.id }),
      });
      // the Cancel button makes the copy anyway
      const foot = $('#sheet-foot');
      const cancel = foot?.querySelector('.btn-outline');
      if (cancel) { cancel.textContent = 'Make a copy anyway'; cancel.onclick = () => { closeSheet(); createFromPaste(text); }; }
      return;
    }
    createFromPaste(text);
  });

  addEventListener('beforeunload', () => { store.flush(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) store.flush(); });
}

async function createFromPaste(text) {
  const { splitFrontmatter } = await import('./parse/lmd.js');
  const { meta } = splitFrontmatter(text);
  const doc = await store.create({
    title: meta.title || firstLine(text),
    subject: meta.subject || settings.get('lastSubject') || '',
    tags: meta.tags || [],
    emoji: meta.emoji || '',
    accent: meta.accent || null,
    markdown: text,
  });
  toast('Note created from your clipboard', { icon: 'check' });
  router.go('reader', { id: doc.id });
}

const firstLine = (t) => {
  const l = t.split('\n').map(s => s.trim()).find(s => s && !/^---/.test(s));
  return (l || 'Pasted note').replace(/^#+\s*/, '').slice(0, 80);
};

async function loadSample() {
  const { SAMPLE } = await import('./core/sample.js');
  const doc = await store.create({
    title: 'The Cardiac Cycle', subject: 'Physiology', emoji: '🫀', accent: 'crimson',
    tags: ['heart', 'exam'], markdown: SAMPLE, source: 'sample',
  });
  router.go('reader', { id: doc.id });
}

/* ---------------- keyboard ---------------- */

const typing = (e) => {
  const t = e.target;
  return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable || t.tagName === 'SELECT');
};

function wireShortcuts() {
  let gPressed = 0;

  addEventListener('keydown', (e) => {
    const cmd = e.metaKey || e.ctrlKey;
    const view = router.current().name;

    /* ---- always ---- */
    if (cmd && e.key.toLowerCase() === 'k') { e.preventDefault(); palette.toggle(); return; }
    if (e.key === 'Escape') {
      if (palette.close()) return;
      if (closeLightbox()) return;
      if (closeMenu()) return;
      if (closeSheet()) return;
      if (view === 'reader') {
        if (reader.keys.findOpen()) { reader.keys.closeFind(); return; }
        if (reader.keys.closePanels()) return;
        if (reader.keys.isFocus()) { reader.keys.focus(false); return; }
        router.go('library'); return;
      }
      if (view === 'editor') { editor.keys.done(); return; }
      if (view !== 'library') { router.go('library'); return; }
      return;
    }
    if (palette.isOpen() || sheetOpen()) return;

    if (cmd && e.key.toLowerCase() === 'n' && !e.shiftKey) { e.preventDefault(); newNote(); return; }
    if (cmd && e.key === ',') { e.preventDefault(); openAppearance(); return; }
    if (cmd && e.key.toLowerCase() === 'i' && view !== 'editor') { e.preventDefault(); router.go('import'); return; }

    if (typing(e)) return;

    if (e.key === '?' || (e.key === '/' && e.shiftKey)) { e.preventDefault(); shortcutsSheet(); return; }

    /* ---- g-prefixed navigation ---- */
    if (e.key.toLowerCase() === 'g' && !cmd) { gPressed = Date.now(); return; }
    if (Date.now() - gPressed < 900) {
      gPressed = 0;
      const k = e.key.toLowerCase();
      if (k === 'l') { router.go('library'); return; }
      if (k === 's') { router.go('study'); return; }
      if (k === 'i') { router.go('import'); return; }
      if (k === 'a') { openAppearance(); return; }
    }

    /* ---- per view ---- */
    if (view === 'library') {
      if (e.key === '/') { e.preventDefault(); $('#lib-search').focus(); $('#lib-search').select(); return; }
      if (e.key.toLowerCase() === 'n') { newNote(); return; }
    }

    if (view === 'reader') {
      const k = reader.keys;
      if (cmd && e.key.toLowerCase() === 'f') { e.preventDefault(); k.find(); return; }
      if (cmd && e.key.toLowerCase() === 'e') { e.preventDefault(); const d = reader.currentDoc(); if (d) router.go('editor', { id: d.id }); return; }
      if (cmd && e.key.toLowerCase() === 'd') { e.preventDefault(); const d = reader.currentDoc(); if (d) router.go('study', { id: d.id }); return; }
      if (cmd && e.key === '\\') { e.preventDefault(); k.outline(); return; }
      if (cmd && e.key.toLowerCase() === 'j') { e.preventDefault(); k.notes(); return; }
      if (cmd) return;
      if (/^[1-5]$/.test(e.key) && k.hasSelection()) { e.preventDefault(); k.highlight(+e.key); return; }
      if (e.key.toLowerCase() === 'n' && k.hasSelection()) { e.preventDefault(); k.note(); return; }
      if (e.key.toLowerCase() === 'c' && k.hasSelection()) { e.preventDefault(); k.card(); return; }
      if ((e.key === 'Backspace' || e.key === 'Delete') && k.hasSelection()) { e.preventDefault(); k.clear(); return; }
      if (e.key === '[') { e.preventDefault(); k.step(-1); return; }
      if (e.key === ']') { e.preventDefault(); k.step(1); return; }
      if (e.key.toLowerCase() === 'f') { e.preventDefault(); k.focus(); return; }
      if (e.key.toLowerCase() === 'j') { k.scroll(180); return; }
      if (e.key.toLowerCase() === 'k') { k.scroll(-180); return; }
      if (e.key === ' ') { e.preventDefault(); k.scroll(e.shiftKey ? -innerHeight * 0.85 : innerHeight * 0.85); return; }
      if (e.key === 'Home') { k.scroll(-1e7); return; }
      if (e.key === 'End') { k.scroll(1e7); return; }
    }

    if (view === 'study') {
      const k = study.keys;
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); k.space(); return; }
      if (/^[1-4]$/.test(e.key)) { e.preventDefault(); k.grade(+e.key); return; }
      if (e.key.toLowerCase() === 's') { e.preventDefault(); k.skip(); return; }
    }
  });

  // ⌘Enter / ⌘S inside the editor are handled by the textarea itself
  addEventListener('keydown', (e) => {
    if (router.current().name !== 'editor') return;
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); editor.keys.done(); }
  });
}

/* ---------------- keeping the notes safe ---------------- */

function offerBackupIfDue() {
  const due = safety.backupDue();
  if (!due) return;
  safety.nudgeShown();
  toast(
    due.never
      ? `You have ${due.docs} notes here and no backup yet.`
      : `Your last backup was ${due.days} days ago.`,
    {
      icon: 'download', kind: 'warn', ms: 14000,
      action: {
        label: 'Back up now',
        fn: async () => {
          const res = await safety.exportBackup();
          toast(`Saved ${res.docs} notes`, { icon: 'check' });
        },
      },
    },
  );
}

/* ---------------- service worker ---------------- */

function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol === 'file:') return;
  addEventListener('load', () => {
    navigator.serviceWorker.register(new URL('../sw.js', import.meta.url), { scope: './' })
      .catch(err => console.warn('[lucid] offline support unavailable', err));
  });
}

boot().catch(err => {
  console.error(err);
  document.getElementById('boot').innerHTML =
    `<p style="max-width:34rem;padding:2rem;font-family:system-ui;line-height:1.6;color:#c9d1dc">
       Lucid could not start: ${String(err && err.message || err)}.<br><br>
       If this keeps happening, your browser may be blocking local storage — try turning off Private Browsing.
     </p>`;
});
