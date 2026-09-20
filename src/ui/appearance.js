/* Lucid — the Appearance & settings sheet. Everything applies live. */

import { $, $$, el, fmtBytes, fmtDate, downloadText, downloadBlob, mod, pluralize } from '../core/util.js';
import * as settings from '../core/settings.js';
import * as store from '../core/store.js';
import { sheet, closeSheet, toast, confirmDialog, sliderRow, toggleRow, optionRow, row } from './ui.js';
import { SAMPLE, WELCOME } from '../core/sample.js';
import * as safety from '../core/safety.js';

let tab = 'theme';
let rerender = () => {};

export function openAppearance(startTab) {
  if (startTab) tab = startTab;
  const body = el('div', { class: 'group', style: { gap: 'var(--gap-5)' } });
  const tabs = el('div', { class: 'set-tabs' },
    ...[['theme', 'Theme'], ['type', 'Type'], ['layout', 'Layout'], ['data', 'Data']].map(([id, name]) =>
      el('button', { class: 'set-tab' + (tab === id ? ' is-on' : ''), text: name, onclick: () => { tab = id; rerender(); } })));

  const content = el('div', { class: 'group', style: { gap: 'var(--gap-5)' } });

  rerender = () => {
    $$('.set-tab', tabs).forEach((b, i) => b.classList.toggle('is-on', ['theme', 'type', 'layout', 'data'][i] === tab));
    content.innerHTML = '';
    ({ theme: themeTab, type: typeTab, layout: layoutTab, data: dataTab })[tab](content);
  };

  body.append(tabs, content);
  rerender();

  sheet({
    title: 'Appearance',
    body,
    foot: [
      el('button', { class: 'btn btn-ghost', text: 'Reset all', onclick: () => confirmDialog({
        title: 'Reset appearance?',
        message: 'Themes, type and layout go back to how they started. Your notes are untouched.',
        confirmLabel: 'Reset',
        onConfirm: () => { settings.reset(); rerender(); toast('Appearance reset', { icon: 'refresh' }); },
      }) }),
      el('button', { class: 'btn btn-primary', text: 'Done', onclick: () => closeSheet() }),
    ],
  });
}

const S = settings.get;
const set = (p) => { settings.set(p); };

/* ---------------- theme ---------------- */

function themeTab(root) {
  const grid = el('div', { class: 'theme-grid' });
  const paint = () => {
    grid.innerHTML = '';
    for (const t of settings.THEMES) {
      grid.append(el('button', {
        class: 'theme-swatch' + (S('theme') === t.id && !S('autoTheme') ? ' is-on' : ''),
        onclick: () => { set({ theme: t.id, autoTheme: false }); rerender(); },
      },
        el('div', { class: 'theme-prev', style: { background: t.bg } },
          el('i', { style: { background: t.ink, opacity: '.9' } }),
          el('i', { style: { background: t.ink, opacity: '.45' } }),
          el('i', { style: { background: t.line } })),
        el('span', { class: 'theme-name', text: t.name })));
    }
  };
  paint();

  root.append(
    el('div', { class: 'group' },
      el('h4', { text: 'Theme' }),
      toggleRow('Follow the system', S('autoTheme'), (v) => { set({ autoTheme: v }); rerender(); },
        'Switches with your iPad’s light and dark mode.'),
      S('autoTheme')
        ? el('div', { class: 'stack' },
            optionRow('Light mode uses', settings.THEMES.filter(t => !t.dark).map(t => ({ id: t.id, name: t.name })), S('lightTheme'), (v) => set({ lightTheme: v })),
            optionRow('Dark mode uses', settings.THEMES.filter(t => t.dark).map(t => ({ id: t.id, name: t.name })), S('darkTheme'), (v) => set({ darkTheme: v })))
        : grid,
    ),

    el('div', { class: 'group' },
      el('h4', { text: 'Accent' }),
      el('div', { class: 'accent-dots' }, ...settings.ACCENTS.map(a => el('button', {
        class: 'accent-dot' + (S('accent') === a.id ? ' is-on' : ''),
        style: { '--c': a.c, width: '28px', height: '28px' }, title: a.name,
        onclick: (e) => { set({ accent: a.id }); $$('.accent-dot', e.currentTarget.parentElement).forEach(d => d.classList.remove('is-on')); e.currentTarget.classList.add('is-on'); },
      }))),
      el('p', { class: 'hint', text: 'A note can carry its own accent — set it in the editor and it takes over while you read.' }),
    ),

    el('div', { class: 'group' },
      el('h4', { text: 'Highlights' }),
      optionRow('Style', [{ id: 'solid', name: 'Block' }, { id: 'marker', name: 'Marker' }, { id: 'underline', name: 'Underline' }], S('hlStyle'), (v) => set({ hlStyle: v })),
      sliderRow('Strength', { min: 0.12, max: 0.6, step: 0.02, value: S('hlAlpha'), format: (v) => Math.round(v * 100) + '%', onInput: (v) => set({ hlAlpha: v }) }).node,
      el('p', { class: 'hint', html: 'Five colours: <b>1</b> butter · <b>2</b> mint · <b>3</b> sky · <b>4</b> rose · <b>5</b> lilac. Press the number while text is selected.' }),
    ),

    el('div', { class: 'group' },
      el('h4', { text: 'Page' }),
      optionRow('Surface', [{ id: 'flat', name: 'Flat' }, { id: 'card', name: 'Card' }], S('paper'), (v) => set({ paper: v })),
      optionRow('Texture', [{ id: 'plain', name: 'None' }, { id: 'grid', name: 'Grid' }, { id: 'dots', name: 'Dots' }, { id: 'lines', name: 'Ruled' }], S('texture'), (v) => set({ texture: v })),
    ),
  );
}

/* ---------------- type ---------------- */

function typeTab(root) {
  const preview = el('div', { class: 'live-preview' },
    el('h4', { text: 'The cardiac cycle' }),
    el('p', { text: 'Blood moves down pressure gradients, and valves open and close only because of the pressure difference either side of them. Every event in the cycle follows from that one fact.' }),
    el('p', { text: 'Two of the four phases move no blood at all — they exist so the ventricle can build and release pressure against closed valves.' }),
  );

  const fonts = el('div', { class: 'font-grid' }, ...settings.FONTS.map(f => el('button', {
    class: 'font-swatch' + (S('font') === f.id ? ' is-on' : ''),
    onclick: (e) => { set({ font: f.id }); $$('.font-swatch', e.currentTarget.parentElement).forEach(b => b.classList.remove('is-on')); e.currentTarget.classList.add('is-on'); },
  },
    el('span', { class: 'fs-a', style: { fontFamily: fontStack(f.id) }, text: 'Ag' }),
    el('span', { class: 'fs-n', text: f.name }))));

  root.append(
    el('div', { class: 'group' }, el('h4', { text: 'Typeface' }), fonts),
    preview,
    el('div', { class: 'group' },
      el('h4', { text: 'Size & rhythm' }),
      sliderRow('Text size', { min: 0.8, max: 1.45, step: 0.01, value: S('fontScale'), format: v => Math.round(v * 100) + '%', onInput: v => set({ fontScale: v }) }).node,
      sliderRow('Line height', { min: 1.3, max: 2.2, step: 0.01, value: S('lineHeight'), format: v => v.toFixed(2), onInput: v => set({ lineHeight: v }) }).node,
      sliderRow('Line length', { min: 40, max: 110, step: 1, value: S('measure'), format: v => v + ' ch', onInput: v => set({ measure: v }) }).node,
      sliderRow('Paragraph gap', { min: 0.4, max: 2.4, step: 0.05, value: S('paraSpace'), format: v => v.toFixed(2) + ' em', onInput: v => set({ paraSpace: v }) }).node,
      sliderRow('First-line indent', { min: 0, max: 2.5, step: 0.1, value: S('paraIndent'), format: v => v ? v.toFixed(1) + ' em' : 'none', onInput: v => set({ paraIndent: v }) }).node,
    ),
    el('div', { class: 'group' },
      el('h4', { text: 'Fine tuning' }),
      sliderRow('Letter spacing', { min: -0.03, max: 0.08, step: 0.005, value: S('letterSpace'), format: v => v.toFixed(3) + ' em', onInput: v => set({ letterSpace: v }) }).node,
      sliderRow('Word spacing', { min: 0, max: 0.3, step: 0.01, value: S('wordSpace'), format: v => v.toFixed(2) + ' em', onInput: v => set({ wordSpace: v }) }).node,
      optionRow('Alignment', [{ id: 'left', name: 'Ragged right' }, { id: 'justify', name: 'Justified' }], S('align'), v => set({ align: v })),
      toggleRow('Hyphenate', S('hyphens'), v => set({ hyphens: v }), 'Worth turning on if you justify — it kills the rivers of white space.'),
    ),
    el('div', { class: 'group' },
      el('h4', { text: 'Headings' }),
      optionRow('Style', [{ id: 'plain', name: 'Plain' }, { id: 'accented', name: 'Accented' }, { id: 'numbered', name: 'Numbered' }, { id: 'rule', name: 'Ruled' }], S('headings'), v => set({ headings: v })),
      sliderRow('Weight', { min: 500, max: 850, step: 10, value: S('headingWeight'), format: v => String(v), onInput: v => set({ headingWeight: v }) }).node,
    ),
  );
}

function fontStack(id) {
  const probe = document.createElement('span');
  probe.setAttribute('data-font', id);
  document.body.append(probe);
  const v = getComputedStyle(probe).getPropertyValue('--font-body');
  probe.remove();
  return v || 'inherit';
}

/* ---------------- layout ---------------- */

function layoutTab(root) {
  root.append(
    el('div', { class: 'group' },
      el('h4', { text: 'Shape' }),
      sliderRow('Corner radius', { min: 0, max: 26, step: 1, value: S('radius'), format: v => v + ' px', onInput: v => set({ radius: v }) }).node,
      sliderRow('Spacing', { min: 0.75, max: 1.35, step: 0.01, value: S('density'), format: v => v < 0.9 ? 'Compact' : v > 1.12 ? 'Roomy' : 'Normal', onInput: v => set({ density: v }) }).node,
      sliderRow('Shadow', { min: 0, max: 1.6, step: 0.05, value: S('shadow'), format: v => v < 0.05 ? 'none' : Math.round(v * 100) + '%', onInput: v => set({ shadow: v }) }).node,
    ),
    el('div', { class: 'group' },
      el('h4', { text: 'Reading aids' }),
      toggleRow('Dim everything but the paragraph under the pointer', S('spotlight') === 'on', v => set({ spotlight: v ? 'on' : 'off' }),
        'Useful on long pages. Needs a mouse or trackpad.'),
      toggleRow('Show images', S('images') === 'shown', v => set({ images: v ? 'shown' : 'hidden' }),
        'Turn off when you want the text and nothing else.'),
      toggleRow('Outline sidebar open by default', S('showOutline'), v => set({ showOutline: v })),
      toggleRow('Highlights panel open by default', S('showNotes'), v => set({ showNotes: v })),
    ),
    el('div', { class: 'group' },
      el('h4', { text: 'Motion' }),
      toggleRow('Animations', S('motion') === 'on', v => set({ motion: v ? 'on' : 'off' }),
        'Off removes every transition — faster, and calmer.'),
    ),
    el('div', { class: 'group' },
      el('h4', { text: 'Keyboard' }),
      el('p', { class: 'hint', text: `You are using a keyboard, so most of Lucid is a keystroke away. ${mod()}K opens the command palette; press ? for the full list.` }),
      el('button', { class: 'btn btn-outline btn-block', onclick: () => { closeSheet(); setTimeout(shortcutsSheet, 120); } },
        el('span', { class: 'i', dataset: { icon: 'keyboard' } }), el('span', { text: 'Keyboard shortcuts' })),
    ),
  );
}

/* ---------------- data ---------------- */

async function dataTab(root) {
  const docs = store.allIncludingArchived();
  const hls = docs.reduce((n, d) => n + (d.highlights || []).length, 0);
  const cards = docs.reduce((n, d) => n + (d.cards || []).length, 0);
  const words = docs.reduce((n, d) => n + store.derived(d).words, 0);

  const statsRow = el('div', { class: 'stat-grid' },
    el('div', { class: 'stat' }, el('b', { text: String(docs.length) }), el('span', { text: 'notes' })),
    el('div', { class: 'stat' }, el('b', { text: words.toLocaleString() }), el('span', { text: 'words' })),
    el('div', { class: 'stat' }, el('b', { text: String(hls) }), el('span', { text: 'highlights' })),
    el('div', { class: 'stat' }, el('b', { text: String(cards) }), el('span', { text: 'cards' })),
  );

  const usage = el('div', { class: 'stack' });
  safety.storageSummary().then(({ usage: u, quota, persisted, lastExport }) => {
    usage.innerHTML = '';
    const pct = quota ? Math.min(100, (u / quota) * 100) : 0;
    usage.append(
      el('div', { class: 'storage-bar' }, el('i', { class: 's-docs', style: { width: pct + '%' } })),
      el('p', { class: 'hint', text: quota ? `${fmtBytes(u)} used of about ${fmtBytes(quota)} available in this browser.` : `${fmtBytes(u)} used.` }),
      el('div', { class: 'row' },
        el('span', { text: 'Protected from clean-up' }),
        el('span', { class: 'val', style: { color: persisted ? 'hsl(150 60% 50%)' : 'var(--ink-4)' },
          text: persisted === null ? 'unknown' : persisted ? 'yes' : 'not yet' })),
      el('p', { class: 'hint', text: persisted
        ? 'The browser has promised not to clear these notes to reclaim space.'
        : 'Add Lucid to your Home Screen and the browser will stop clearing it to reclaim space. Until then, keep a backup.' }),
      el('div', { class: 'row' },
        el('span', { text: 'Last backup' }),
        el('span', { class: 'val', text: lastExport ? fmtDate(lastExport) : 'never' })),
    );
  });

  root.append(
    el('div', { class: 'group' }, el('h4', { text: 'What you have' }), statsRow),
    el('div', { class: 'group' }, el('h4', { text: 'Storage' }), usage,
      el('p', { class: 'hint', text: store.usingFallback()
        ? 'This browser blocked its database, so Lucid is using a smaller fallback store. Back up regularly.'
        : 'Everything lives on this device. Nothing is ever uploaded.' })),

    el('div', { class: 'group' },
      el('h4', { text: 'Backup' }),
      el('button', { class: 'btn btn-outline btn-block', onclick: doExport },
        el('span', { class: 'i', dataset: { icon: 'download' } }), el('span', { text: 'Export everything' })),
      el('button', { class: 'btn btn-outline btn-block', onclick: doImport },
        el('span', { class: 'i', dataset: { icon: 'upload' } }), el('span', { text: 'Restore from a backup' })),
      el('p', { class: 'hint', text: 'One file with every note, highlight, card and image inside it. Keep a copy in iCloud Drive — clearing Safari’s website data would otherwise take your notes with it.' }),
    ),

    el('div', { class: 'group' },
      el('h4', { text: 'Housekeeping' }),
      el('button', { class: 'btn btn-outline btn-block', onclick: async () => {
        const freed = await store.pruneImages();
        toast(freed ? `Freed ${fmtBytes(freed)}` : 'Nothing to clean up', { icon: 'check' });
      } }, el('span', { class: 'i', dataset: { icon: 'refresh' } }), el('span', { text: 'Remove unused images' })),
      el('button', { class: 'btn btn-outline btn-block', onclick: async () => {
        const d = await store.create({ title: 'The Cardiac Cycle', subject: 'Physiology', emoji: '🫀', accent: 'crimson', tags: ['heart', 'exam'], markdown: SAMPLE, source: 'sample' });
        closeSheet(); toast('Sample note added', { icon: 'check' });
        location.hash = `#/reader?id=${d.id}`;
      } }, el('span', { class: 'i', dataset: { icon: 'sparkle' } }), el('span', { text: 'Add the sample note' })),
    ),

    el('div', { class: 'group' },
      el('h4', { text: 'Danger' }),
      el('button', { class: 'btn btn-danger btn-block', onclick: () => confirmDialog({
        title: 'Delete everything?',
        message: `All ${pluralize(docs.length, 'note')}, ${pluralize(hls, 'highlight')} and every stored image will be erased from this device. Export a backup first if you are not certain.`,
        confirmLabel: 'Delete everything', danger: true,
        onConfirm: async () => { await store.db.wipeAll(); location.reload(); },
      }) }, el('span', { class: 'i', dataset: { icon: 'trash' } }), el('span', { text: 'Delete all notes' })),
    ),

    el('div', { class: 'group' },
      el('h4', { text: 'About' }),
      el('p', { class: 'hint', text: 'Lucid — a quiet place to read what you have to learn. Works offline. Add it to your Home Screen from the Share menu and it opens like an app.' }),
    ),
  );
}

async function doExport() {
  toast('Packing everything up…', { icon: 'download', ms: 1500 });
  const res = await safety.exportBackup();
  toast(`Exported ${pluralize(res.docs, 'note')}`, { icon: 'check' });
  rerender();
}

function doImport() {
  const input = el('input', { type: 'file', accept: '.json,application/json', style: { display: 'none' } });
  input.addEventListener('change', async () => {
    const f = input.files[0]; input.remove();
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      confirmDialog({
        title: 'Restore this backup?',
        message: `It contains ${pluralize((data.docs || []).length, 'note')} and ${pluralize((data.images || []).length, 'image')}. They will be added alongside what you already have.`,
        confirmLabel: 'Restore',
        onConfirm: async () => {
          const n = await store.importBackup(data, { merge: true });
          toast(`Restored ${pluralize(n, 'note')}`, { icon: 'check' });
          closeSheet();
          location.hash = '#/library';
          location.reload();
        },
      });
    } catch (e) {
      toast('That file is not a Lucid backup', { kind: 'err', icon: 'help' });
    }
  });
  document.body.append(input);
  input.click();
}

/* ---------------- shortcuts ---------------- */

export function shortcutsSheet() {
  const m = mod();
  const SECTIONS = [
    ['Anywhere', [
      [`${m}K`, 'Command palette — search notes and run anything'],
      [`${m}N`, 'New note'],
      [`${m},`, 'Appearance'],
      ['?', 'This list'],
      ['Esc', 'Close / go back'],
    ]],
    ['Library', [
      ['/', 'Search'],
      ['⏎', 'Open the first result'],
      [`${m}I`, 'Import a file'],
      ['G then S', 'Study everything due'],
    ]],
    ['Reading', [
      ['1 – 5', 'Highlight the selection in that colour'],
      ['N', 'Add a note to the selection'],
      ['C', 'Turn the selection into a flashcard'],
      ['⌫', 'Remove the highlight under the selection'],
      [`${m}F`, 'Find in this note'],
      [`${m}E`, 'Edit this note'],
      [`${m}D`, 'Study this note'],
      [`${m}\\`, 'Outline sidebar'],
      [`${m}J`, 'Highlights & notes'],
      ['F', 'Focus mode'],
      ['J / K', 'Scroll down / up'],
      ['Space', 'Page down'],
    ]],
    ['Editing', [
      [`${m}B`, 'Bold'],
      [`${m}I`, 'Italic'],
      [`${m}H`, 'Mark as important'],
      ['Tab', 'Indent'],
      [`${m}S`, 'Save now'],
      [`${m}⏎`, 'Done'],
    ]],
    ['Flashcards', [
      ['Space', 'Show the answer, then grade it Good'],
      ['1 – 4', 'Again · Hard · Good · Easy'],
      ['S', 'Skip this card'],
    ]],
  ];

  const grid = el('div', { class: 'kbd-table' });
  for (const [name, rows] of SECTIONS) {
    grid.append(el('div', { class: 'kbd-sec', text: name }));
    for (const [key, what] of rows) {
      grid.append(el('span', { text: what }), el('div', {}, ...key.split(' ').map(k => el('kbd', { text: k }))));
    }
  }
  sheet({ title: 'Keyboard shortcuts', body: grid, foot: el('button', { class: 'btn btn-primary', text: 'Done', onclick: () => closeSheet() }) });
}
