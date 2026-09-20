/* Lucid — ⌘K: one box for every note, every heading and every command. */

import { $, $$, el, fuzzy, norm, highlightMatch, mod, debounce } from '../core/util.js';
import * as store from '../core/store.js';
import { closeMenu, closeSheet } from './ui.js';

let open = false;
let items = [];
let active = 0;
let commands = [];
let bound = false;

export const isOpen = () => open;
export function setCommands(list) { commands = list; }

export function toggle() { open ? close() : show(); }

export function show(prefill = '') {
  bind();
  closeMenu();
  open = true;
  $('#palette').hidden = false;
  $('#scrim').hidden = false;
  $('#scrim').onclick = close;
  const input = $('#palette-input');
  input.value = prefill;
  input.focus();
  input.select();
  search(prefill);
}

export function close() {
  if (!open) return false;
  open = false;
  $('#palette').hidden = true;
  if ($('#sheet').hidden) { $('#scrim').hidden = true; $('#scrim').onclick = null; }
  return true;
}

function search(q) {
  const list = $('#palette-list');
  list.innerHTML = '';
  items = [];

  const query = q.trim();
  const cmds = commands
    .map(c => ({ ...c, score: query ? fuzzy(query, c.label + ' ' + (c.keywords || '')) : 0 }))
    .filter(c => !query || c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, query ? 6 : 8);

  const docs = [];
  if (query) {
    for (const doc of store.all()) {
      const d = store.derived(doc);
      const titleScore = fuzzy(query, doc.title + ' ' + (doc.subject || '') + ' ' + (doc.tags || []).join(' '));
      const bodyHit = norm(d.text).indexOf(norm(query));
      if (titleScore > 0 || bodyHit >= 0) {
        docs.push({
          kind: 'doc', doc,
          score: Math.max(titleScore, bodyHit >= 0 ? 400 - Math.min(380, bodyHit / 40) : 0),
          snippet: bodyHit >= 0 ? snippetAround(d.text, bodyHit, query.length) : (doc.subject || ''),
        });
      }
    }
    docs.sort((a, b) => b.score - a.score);
  } else {
    store.all().slice().sort((a, b) => (b.openedAt || b.updatedAt) - (a.openedAt || a.updatedAt)).slice(0, 6)
      .forEach(doc => docs.push({ kind: 'doc', doc, snippet: doc.subject || '' }));
  }

  if (cmds.length) {
    list.append(el('div', { class: 'pal-group', text: query ? 'Commands' : 'Quick actions' }));
    cmds.forEach(c => add(list, {
      icon: c.icon, label: c.label, sub: c.sub, run: c.fn, q: query,
    }));
  }

  if (docs.length) {
    list.append(el('div', { class: 'pal-group', text: query ? 'Notes' : 'Recent' }));
    docs.slice(0, 12).forEach(d => add(list, {
      icon: 'book',
      label: (d.doc.emoji ? d.doc.emoji + '  ' : '') + d.doc.title,
      sub: d.snippet,
      run: () => { close(); location.hash = `#/reader?id=${d.doc.id}`; },
      q: query,
    }));
  }

  if (!items.length) {
    list.append(el('div', { class: 'pal-empty' },
      el('p', { text: `Nothing matches “${q}”.` }),
      el('p', { class: 'hint', style: { marginTop: '8px' }, text: 'Try a word from inside a note — Lucid searches the whole text.' })));
  }
  active = 0;
  paint();
}

function snippetAround(text, at, len) {
  const start = Math.max(0, at - 42);
  const raw = text.slice(start, at + len + 78).replace(/\s+/g, ' ');
  return (start ? '…' : '') + raw.trim() + '…';
}

function add(list, { icon, label, sub, run, q }) {
  const node = el('button', { class: 'pal-item', onclick: run },
    el('span', { class: 'i', dataset: { icon: icon || 'chevron' } }),
    el('span', { class: 'pal-t', html: highlightMatch(label, q) }),
    sub ? el('span', { class: 'pal-s', text: sub.length > 60 ? sub.slice(0, 58) + '…' : sub }) : null,
  );
  node.addEventListener('mousemove', () => { active = items.indexOf(entry); paint(); });
  const entry = { node, run };
  items.push(entry);
  list.append(node);
}

function paint() {
  items.forEach((it, i) => it.node.classList.toggle('is-active', i === active));
  items[active]?.node.scrollIntoView({ block: 'nearest' });
}

function step(d) {
  if (!items.length) return;
  active = (active + d + items.length) % items.length;
  paint();
}

function bind() {
  if (bound) return;
  bound = true;
  const input = $('#palette-input');
  input.addEventListener('input', debounce(e => search(e.target.value), 90));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); step(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); step(-1); }
    else if (e.key === 'Enter') { e.preventDefault(); items[active]?.run(); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'Tab') { e.preventDefault(); step(e.shiftKey ? -1 : 1); }
  });
}
