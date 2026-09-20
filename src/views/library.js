/* Lucid — library view */

import { $, $$, el, fmtDate, countWords, readTime, norm, pluralize } from '../core/util.js';
import * as store from '../core/store.js';
import * as settings from '../core/settings.js';
import { menu, toast, confirmDialog } from '../ui/ui.js';
import { go } from '../core/router.js';

let filterSubject = '';
let filterTags = new Set();
let query = '';
let bound = false;
let actions = {};

export function configure(a) { actions = a; }

export const view = {
  async mount() {
    bind();
    $('#lib-search').value = query;
    $('#lib-sort').value = settings.get('libSort');
    $('#lib-cards').dataset.layout = settings.get('libLayout');
    $$('.seg-btn[data-layout]').forEach(b => b.classList.toggle('is-on', b.dataset.layout === settings.get('libLayout')));
    render();
  },
  refresh: render,
};

function bind() {
  if (bound) return;
  bound = true;

  $('#lib-search').addEventListener('input', (e) => { query = e.target.value; render(); });
  $('#lib-search').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); e.target.value = ''; query = ''; render(); e.target.blur(); }
    if (e.key === 'Enter') {
      const first = $('#lib-cards .ncard');
      if (first) { e.target.blur(); go('reader', { id: first.dataset.id }); }
    }
  });
  $('#lib-sort').addEventListener('change', (e) => { settings.set({ libSort: e.target.value }); render(); });
  $$('.seg-btn[data-layout]').forEach(b => b.addEventListener('click', () => {
    settings.set({ libLayout: b.dataset.layout });
    $('#lib-cards').dataset.layout = b.dataset.layout;
    $$('.seg-btn[data-layout]').forEach(x => x.classList.toggle('is-on', x === b));
  }));

  store.onChange(() => { if (!$('.view-library').hidden) render(); });
}

export function setQuery(q) { query = q; const i = $('#lib-search'); if (i) i.value = q; render(); }
export function setSubject(s) { filterSubject = s; render(); }
export function toggleTag(t) {
  filterTags.has(t) ? filterTags.delete(t) : filterTags.add(t);
  render();
}
const clearFilters = () => { query = ''; filterSubject = ''; filterTags.clear(); const i = $('#lib-search'); if (i) i.value = ''; render(); };

function sortDocs(list) {
  const how = settings.get('libSort');
  const cmp = {
    updated: (a, b) => b.updatedAt - a.updatedAt,
    opened: (a, b) => (b.openedAt || 0) - (a.openedAt || 0) || b.updatedAt - a.updatedAt,
    created: (a, b) => b.createdAt - a.createdAt,
    title: (a, b) => a.title.localeCompare(b.title),
    subject: (a, b) => (a.subject || 'zzz').localeCompare(b.subject || 'zzz') || a.title.localeCompare(b.title),
    progress: (a, b) => (a.progress || 0) - (b.progress || 0),
  }[how] || ((a, b) => b.updatedAt - a.updatedAt);
  const pin = (d) => (d.pinned ? 1 : 0);
  return list.sort((a, b) => (pin(b) - pin(a)) || cmp(a, b));
}

function matches(doc, q) {
  if (!q) return true;
  const n = norm(q);
  if (norm(doc.title).includes(n)) return true;
  if (norm(doc.subject || '').includes(n)) return true;
  if ((doc.tags || []).some(t => norm(t).includes(n))) return true;
  if (norm(store.derived(doc).text).includes(n)) return true;
  return (doc.highlights || []).some(h => norm(h.text).includes(n) || norm(h.note || '').includes(n));
}

export function render() {
  const wrap = $('#lib-cards');
  if (!wrap) return;
  const allDocs = store.all();

  // subject chips
  const subs = store.subjects();
  const chips = $('#lib-subjects');
  chips.innerHTML = '';
  if (subs.length) {
    chips.append(el('button', {
      class: 'chip' + (filterSubject === '' ? ' is-on' : ''),
      onclick: () => { filterSubject = ''; render(); },
    }, el('span', { text: 'All' }), el('span', { class: 'n', text: String(allDocs.length) })));
    for (const s of subs) {
      chips.append(el('button', {
        class: 'chip' + (filterSubject === s.name ? ' is-on' : ''),
        onclick: () => { filterSubject = filterSubject === s.name ? '' : s.name; render(); },
      }, el('span', { text: s.name }), el('span', { class: 'n', text: String(s.n) })));
    }
  }

  const inSubject = allDocs.filter(d => !filterSubject || d.subject === filterSubject);

  // tag chips, for whatever subject is in view
  const tagCounts = new Map();
  for (const d of inSubject) for (const t of d.tags || []) tagCounts.set(t, (tagCounts.get(t) || 0) + 1);
  for (const t of filterTags) if (!tagCounts.has(t)) tagCounts.set(t, 0);
  const tags = Array.from(tagCounts, ([name, n]) => ({ name, n }))
    .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));

  const tagRow = $('#lib-tags');
  tagRow.innerHTML = '';
  tagRow.hidden = tags.length < 2;
  for (const t of tags.slice(0, 14)) {
    tagRow.append(el('button', {
      class: 'chip chip-tag' + (filterTags.has(t.name) ? ' is-on' : ''),
      onclick: () => toggleTag(t.name),
    }, el('span', { text: '#' + t.name }), el('span', { class: 'n', text: String(t.n) })));
  }
  if (filterTags.size) {
    tagRow.append(el('button', {
      class: 'chip chip-clear', onclick: () => { filterTags.clear(); render(); },
    }, el('span', { class: 'i', dataset: { icon: 'x' } }), el('span', { text: 'Clear tags' })));
  }

  const list = sortDocs(inSubject.filter(d =>
    (!filterTags.size || [...filterTags].every(t => (d.tags || []).includes(t))) && matches(d, query)));

  // header stats
  const words = allDocs.reduce((n, d) => n + store.derived(d).words, 0);
  const hls = allDocs.reduce((n, d) => n + (d.highlights || []).length, 0);
  const due = dueCount(allDocs);
  $('#lib-greeting').textContent = greeting();
  $('#lib-stats').textContent = allDocs.length
    ? [
        pluralize(allDocs.length, 'note'),
        `${words.toLocaleString()} words`,
        hls ? pluralize(hls, 'highlight') : null,
        due ? `${due} card${due === 1 ? '' : 's'} due` : null,
      ].filter(Boolean).join(' · ')
    : 'Nothing saved yet — paste something in.';

  const empty = $('#lib-empty');
  empty.hidden = allDocs.length > 0;
  wrap.hidden = allDocs.length === 0;
  wrap.innerHTML = '';

  if (allDocs.length && !list.length) {
    wrap.append(el('div', { class: 'lib-empty', style: { gridColumn: '1/-1' } },
      el('h2', { text: 'No matches' }),
      el('p', { text: query
        ? `Nothing here contains “${query}”.`
        : filterTags.size
          ? `Nothing is tagged ${[...filterTags].map(t => '#' + t).join(' and ')}.`
          : 'Nothing in this subject yet.' }),
      el('div', { class: 'empty-actions' },
        el('button', { class: 'btn btn-outline', text: 'Clear filters', onclick: clearFilters }))));
    return;
  }

  for (const doc of list) wrap.append(card(doc));
}

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return 'Still up';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  if (h < 22) return 'Good evening';
  return 'Late session';
}

export function dueCount(docs = store.all()) {
  const now = Date.now();
  return docs.reduce((n, d) => n + (d.cards || []).filter(c => (c.due || 0) <= now).length, 0);
}

function card(doc) {
  const d = store.derived(doc);
  const wordCount = d.words;
  const accent = doc.accent ? settings.ACCENTS.find(a => a.id === doc.accent)?.c : null;
  const pct = Math.round((doc.progress || 0) * 100);

  const node = el('article', {
    class: 'ncard' + (doc.pinned ? ' is-pinned' : ''),
    dataset: { id: doc.id },
    tabindex: '0',
    style: accent ? { '--card-accent': accent } : {},
    onclick: (e) => { if (!e.target.closest('.ncard-menu')) go('reader', { id: doc.id }); },
    onkeydown: (e) => { if (e.key === 'Enter') go('reader', { id: doc.id }); },
    oncontextmenu: (e) => { e.preventDefault(); openMenu(doc, { x: e.clientX, y: e.clientY }); },
  },
    el('div', { class: 'ncard-top' },
      doc.emoji ? el('span', { class: 'ncard-emoji', text: doc.emoji }) : null,
      el('h3', { class: 'ncard-title', text: doc.title || 'Untitled' }),
      el('button', {
        class: 'btn btn-icon btn-xs ncard-menu', title: 'More',
        onclick: (e) => { e.stopPropagation(); openMenu(doc, { anchor: e.currentTarget }); },
      }, el('span', { class: 'i', dataset: { icon: 'more' } })),
    ),
    d.excerpt ? el('p', { class: 'ncard-excerpt', text: d.excerpt }) : null,
    (doc.subject || doc.tags?.length)
      ? el('div', { class: 'ncard-tags' },
          doc.subject
            ? el('button', { class: 'tag tag-btn', title: `Only ${doc.subject}`, text: doc.subject,
                onclick: (e) => { e.stopPropagation(); filterSubject = filterSubject === doc.subject ? '' : doc.subject; render(); } })
            : null,
          ...(doc.tags || []).slice(0, 4).map(t => el('button', {
            class: 'tag tag-btn' + (filterTags.has(t) ? ' is-on' : ''), title: `Filter by #${t}`, text: '#' + t,
            onclick: (e) => { e.stopPropagation(); toggleTag(t); },
          })))
      : null,
    el('div', { class: 'ncard-foot' },
      el('span', { text: `${readTime(wordCount)} min` }),
      el('span', { class: 'sep' }),
      el('span', { text: fmtDate(doc.updatedAt) }),
      (doc.highlights?.length)
        ? el('span', { class: 'ncard-hl' }, el('span', { class: 'sep' }), el('span', { class: 'i', dataset: { icon: 'marker' }, style: { width: '.9em', height: '.9em' } }), el('span', { text: String(doc.highlights.length) }))
        : null,
      el('span', { class: 'spacer' }),
      pct > 2 ? ring(pct) : null,
    ),
  );
  return node;
}

function ring(pct) {
  const r = 8.5, c = 2 * Math.PI * r;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'ring'); svg.setAttribute('viewBox', '0 0 22 22');
  svg.innerHTML =
    `<circle class="bgc" cx="11" cy="11" r="${r}"></circle>` +
    `<circle class="fgc" cx="11" cy="11" r="${r}" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - pct / 100)}"></circle>`;
  svg.setAttribute('title', `${pct}% read`);
  return svg;
}

function openMenu(doc, pos) {
  menu([
    { label: 'Open', icon: 'eye', fn: () => go('reader', { id: doc.id }) },
    { label: 'Edit', icon: 'pencil', fn: () => go('editor', { id: doc.id }) },
    { label: doc.pinned ? 'Unpin' : 'Pin to top', icon: 'pin', fn: async () => { doc.pinned = !doc.pinned; await store.save(doc, { touch: false }); render(); } },
    '-',
    { label: 'Study this note', icon: 'cards', fn: () => go('study', { id: doc.id }) },
    { label: 'Duplicate', icon: 'copy', fn: async () => { const c = await store.duplicate(doc.id); toast('Duplicated'); render(); } },
    { label: 'Export…', icon: 'download', fn: () => actions.exportDoc?.(doc) },
    { label: 'Print / PDF', icon: 'print', fn: () => actions.printDoc?.(doc) },
    '-',
    { label: 'Delete', icon: 'trash', danger: true, fn: () => confirmDialog({
        title: 'Delete this note?',
        message: `“${doc.title}” and its ${pluralize(doc.highlights?.length || 0, 'highlight')} will be removed from this device. This cannot be undone.`,
        confirmLabel: 'Delete', danger: true,
        onConfirm: async () => { await store.remove(doc.id); toast('Note deleted', { icon: 'trash' }); render(); },
      }) },
  ], pos);
}
