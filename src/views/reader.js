/* Lucid — reader view: render, highlight, annotate, navigate. */

import { $, $$, el, throttle, debounce, fmtDate, readTime, escapeHtml, copyText, uid, clamp, naturalCompare, add } from '../core/util.js';
import * as store from '../core/store.js';
import * as settings from '../core/settings.js';
import { render as renderAst } from '../parse/render.js';
import { plain } from '../parse/lmd.js';
import * as HL from '../core/highlights.js';
import { createPager } from '../core/pager.js';
import { menu, toast, sheet, closeSheet, lightbox, confirmDialog, promptDialog } from '../ui/ui.js';
import { go, back } from '../core/router.js';

let doc = null;
let derived = null;
let outlineData = [];
let bound = false;
let activeAnchors = [];
let hlFilter = new Set();
let findState = { q: '', hits: [], idx: -1 };
let pager = null;
let actions = {};

export function configure(a) { actions = a; }
export const currentDoc = () => doc;

export const view = {
  async mount({ id }) {
    doc = store.get(id);
    if (!doc) { toast('That note no longer exists', { kind: 'warn', icon: 'help' }); go('library', {}, { replace: true }); return; }
    bind();
    doc.openedAt = Date.now();
    store.saveSoon(doc);
    await store.preloadImages(doc);
    renderDoc();
    applyPanels();
    pager.setMode(settings.get('flow'));
    requestAnimationFrame(() => {
      relayout();
      if (pager.paged) pager.restore(doc.progress || 0);
      else {
        const main = $('#read-main');
        main.scrollTop = (doc.progress || 0) * Math.max(0, main.scrollHeight - main.clientHeight);
      }
      updateProgress();
    });
  },
  async unmount() {
    saveProgress.flush?.();
    await store.flush();
    closeFind();
    $('.view-reader').classList.remove('is-focus');
    document.documentElement.dataset.accent = settings.get('accent');
  },
  refresh() { if (doc) renderDoc(); },
};

/* ---------------- rendering ---------------- */

function renderDoc() {
  derived = store.derived(doc);
  const ctx = { img: (src) => store.resolveImage(src) };
  const { html, outline } = renderAst(derived.blocks, ctx);
  outlineData = outline;

  const prose = $('#prose');
  prose.innerHTML = html;

  // header
  const head = $('#paper-head');
  head.innerHTML = '';
  const sub = doc.subject || derived.meta.subject;
  add(head,
    sub || doc.emoji
      ? el('div', { class: 'paper-kicker' },
          doc.emoji ? el('span', { text: doc.emoji, style: { fontSize: '1.1em' } }) : null,
          sub ? el('span', { text: sub }) : null)
      : null,
    el('h1', { class: 'paper-title', text: doc.title || 'Untitled note' }),
    el('div', { class: 'paper-meta' },
      el('span', { text: `${readTime(derived.words)} min read` }),
      el('span', { class: 'dotsep' }),
      el('span', { text: `${derived.words.toLocaleString()} words` }),
      el('span', { class: 'dotsep' }),
      el('span', { text: `edited ${fmtDate(doc.updatedAt)}` }),
      ...(doc.tags || []).map(t => el('span', { class: 'tag', text: '#' + t })),
    ),
  );

  const foot = $('#paper-foot');
  foot.innerHTML = '';
  add(foot,
    el('span', { text: `Added ${fmtDate(doc.createdAt)}` }),
    el('span', { class: 'dotsep' }),
    el('button', { class: 'btn btn-sm btn-ghost', onclick: () => go('editor', { id: doc.id }) },
      el('span', { class: 'i', dataset: { icon: 'pencil' } }), el('span', { text: 'Edit this note' })),
    derived.quiz.length
      ? el('button', { class: 'btn btn-sm btn-ghost', onclick: () => go('study', { id: doc.id }) },
          el('span', { class: 'i', dataset: { icon: 'cards' } }), el('span', { text: `Study ${derived.quiz.length} cards` }))
      : null,
  );

  // title bar
  $('#doc-name').textContent = doc.title || 'Untitled';
  $('#doc-emoji').textContent = doc.emoji || '';
  const subjEl = $('#doc-subject');
  subjEl.textContent = sub || '';
  subjEl.hidden = !sub;
  if (doc.accent) document.documentElement.dataset.accent = doc.accent;
  else document.documentElement.dataset.accent = settings.get('accent');

  renderNeighbours();
  repaintHighlights();
  buildOutline();
  renderNotesPanel();

  if (pager) requestAnimationFrame(relayout);

  $('#meta-words').textContent = derived.words.toLocaleString();
  $('#meta-time').textContent = `${readTime(derived.words)} min`;
  $('#meta-hl').textContent = String(doc.highlights.length);
  $('#hl-count-dot').hidden = !doc.highlights.length;
}

function repaintHighlights() {
  const prose = $('#prose');
  const before = JSON.stringify(doc.highlights.map(h => [h.bid, h.start, h.end, !!h.orphan]));
  doc.highlights.forEach(h => HL.unpaint(prose, h.id));
  const orphans = HL.paint(prose, doc.highlights);
  doc.highlights.forEach(h => { if (orphans.includes(h)) h.orphan = true; else delete h.orphan; });
  const after = JSON.stringify(doc.highlights.map(h => [h.bid, h.start, h.end, !!h.orphan]));
  if (before !== after) store.saveSoon(doc);   // a highlight relocated itself
}

function buildOutline() {
  const list = $('#outline-list');
  list.innerHTML = '';
  if (!outlineData.length) {
    list.append(el('p', { class: 'hl-empty', text: 'This note has no headings yet. Add ## sections to build an outline.' }));
    return;
  }
  for (const h of outlineData) {
    list.append(el('button', {
      class: `o-item o-${h.level}`, dataset: { target: h.id }, title: h.text, text: h.text,
      onclick: () => {
        const target = document.getElementById(h.id);
        if (!target) return;
        if (pager?.paged) pager.go(pager.pageOf(target));
        else target.scrollIntoView({ block: 'start', behavior: settings.get('motion') === 'off' ? 'auto' : 'smooth' });
        updateProgress();
        if (innerWidth <= 1000) togglePanel('outline', false);
      },
    }));
  }
}

/* ---------------- moving between notes ---------------- */

/**
 * The other notes in this subject, in the order a person would read them —
 * "Lecture 2" before "Lecture 10". Notes with no subject sit together.
 */
function siblings() {
  const subject = (doc.subject || '').trim();
  return store.all()
    .filter(d => (d.subject || '').trim() === subject)
    .sort((a, b) => naturalCompare(a.title, b.title));
}

function neighbours() {
  const list = siblings();
  const i = list.findIndex(d => d.id === doc.id);
  if (i < 0) return { prev: null, next: null, position: null, total: list.length };
  return { prev: list[i - 1] || null, next: list[i + 1] || null, position: i + 1, total: list.length };
}

function renderNeighbours() {
  const wrap = $('#paper-next');
  wrap.innerHTML = '';
  const { prev, next, position, total } = neighbours();
  if (!prev && !next) { wrap.hidden = true; return; }
  wrap.hidden = false;

  const card = (d, dir) => el('button', {
    class: `next-card next-${dir}`,
    onclick: () => go('reader', { id: d.id }),
  },
    el('span', { class: 'next-dir' },
      dir === 'prev' ? el('span', { class: 'i', dataset: { icon: 'back' } }) : null,
      el('span', { text: dir === 'prev' ? 'Previous' : 'Next' }),
      dir === 'next' ? el('span', { class: 'i', dataset: { icon: 'fwd' } }) : null),
    el('span', { class: 'next-title' }, d.emoji ? el('span', { text: d.emoji + ' ' }) : null, el('span', { text: d.title })),
  );

  wrap.append(
    el('div', { class: 'next-label' },
      el('span', { text: doc.subject ? `${doc.subject} — ${position} of ${total}` : `${position} of ${total} notes` })),
    el('div', { class: 'next-row' },
      prev ? card(prev, 'prev') : el('span'),
      next ? card(next, 'next') : el('span')),
  );
}

/** Re-measure after anything that changes how the text flows. */
function relayout() {
  if (!pager) return;
  const where = pager.progress();
  pager.measure();
  if (pager.paged) pager.restore(where);
  updateProgress();
}

/* ---------------- panels ---------------- */

const OVERLAY_AT = 1000;   // below this the panels float over the page

function applyPanels() {
  const shell = $('.read-shell');
  const roomy = innerWidth > OVERLAY_AT;
  shell.classList.toggle('show-outline', settings.get('showOutline') && roomy);
  shell.classList.toggle('show-notes', settings.get('showNotes') && roomy);
}

function closeOverlayPanels() {
  if (innerWidth > OVERLAY_AT) return false;
  const shell = $('.read-shell');
  if (!shell.classList.contains('show-outline') && !shell.classList.contains('show-notes')) return false;
  shell.classList.remove('show-outline', 'show-notes');
  return true;
}

function togglePanel(which, force) {
  const shell = $('.read-shell');
  const cls = which === 'outline' ? 'show-outline' : 'show-notes';
  const on = force === undefined ? !shell.classList.contains(cls) : force;
  // only one panel at a time once they float over the page
  if (on && innerWidth <= OVERLAY_AT) shell.classList.remove('show-outline', 'show-notes');
  shell.classList.toggle(cls, on);
  if (innerWidth > OVERLAY_AT) settings.set(which === 'outline' ? { showOutline: on } : { showNotes: on }, true);
}

/* ---------------- notes panel ---------------- */

function renderNotesPanel() {
  const filterWrap = $('#hl-filter');
  filterWrap.innerHTML = '';
  filterWrap.append(el('button', {
    class: 'hl-fchip all' + (hlFilter.size === 0 ? ' is-on' : ''), text: 'All',
    onclick: () => { hlFilter.clear(); renderNotesPanel(); },
  }));
  for (const c of settings.HL_COLORS) {
    const n = doc.highlights.filter(h => h.color === c.id).length;
    if (!n) continue;
    filterWrap.append(el('button', {
      class: 'hl-fchip' + (hlFilter.has(c.id) ? ' is-on' : ''),
      style: { '--h': String(c.h) }, title: `${c.name} · ${n}`,
      onclick: () => { hlFilter.has(c.id) ? hlFilter.delete(c.id) : hlFilter.add(c.id); renderNotesPanel(); },
    }));
  }

  const list = $('#hl-list');
  list.innerHTML = '';
  const items = doc.highlights
    .filter(h => !hlFilter.size || hlFilter.has(h.color))
    .slice()
    .sort(byDocumentOrder);

  if (!items.length) {
    list.append(el('p', { class: 'hl-empty', text: doc.highlights.length
      ? 'No highlights in that colour.'
      : 'Select any text in the note to highlight it, attach a note, or turn it into a flashcard.' }));
    return;
  }

  for (const h of items) {
    list.append(el('div', {
      class: 'hl-card', style: { '--h': String(HL.hueOf(h.color)) },
      onclick: () => jumpToHighlight(h),
    },
      el('div', { class: 'hl-card-text', text: h.text }),
      h.note ? el('div', { class: 'hl-card-note' },
        el('span', { class: 'i', dataset: { icon: 'note' } }),
        el('span', { text: h.note })) : null,
      el('div', { class: 'hl-card-foot' },
        h.orphan ? el('span', { text: 'moved', title: 'The text this was attached to changed' }) : el('span', { text: fmtDate(h.createdAt) }),
        el('span', { class: 'spacer' }),
        el('button', { class: 'btn btn-icon btn-xs', title: h.note ? 'Edit note' : 'Add note',
          onclick: (e) => { e.stopPropagation(); editNote(h); } }, el('span', { class: 'i', dataset: { icon: 'note' } })),
        el('button', { class: 'btn btn-icon btn-xs', title: 'Make a flashcard',
          onclick: (e) => { e.stopPropagation(); cardFromHighlight(h); } }, el('span', { class: 'i', dataset: { icon: 'cards' } })),
        el('button', { class: 'btn btn-icon btn-xs', title: 'Remove',
          onclick: (e) => { e.stopPropagation(); removeHighlight(h); } }, el('span', { class: 'i', dataset: { icon: 'trash' } })),
      ),
    ));
  }
}

function byDocumentOrder(a, b) {
  const na = +String(a.bid).replace(/\D/g, ''), nb = +String(b.bid).replace(/\D/g, '');
  return (na - nb) || (a.start - b.start);
}

function jumpToHighlight(h) {
  const span = $(`#prose [data-hl="${CSS.escape(h.id)}"]`);
  if (!span) { toast('That highlight has drifted — reopen the note to relocate it', { kind: 'warn', icon: 'help' }); return; }
  if (pager?.paged) pager.go(pager.pageOf(span));
  else span.scrollIntoView({ block: 'center', behavior: settings.get('motion') === 'off' ? 'auto' : 'smooth' });
  $$('#prose .hl.is-focus').forEach(s => s.classList.remove('is-focus'));
  $$(`#prose [data-hl="${CSS.escape(h.id)}"]`).forEach(s => s.classList.add('is-focus'));
  setTimeout(() => $$('#prose .hl.is-focus').forEach(s => s.classList.remove('is-focus')), 2200);
}

/* ---------------- highlights ---------------- */

function addHighlight(color) {
  if (!activeAnchors.length) return;
  let created = null;
  for (const anchor of activeAnchors) {
    const overlaps = HL.overlapping(doc.highlights, anchor);
    const same = overlaps.filter(o => o.color === color);
    const other = overlaps.filter(o => o.color !== color);
    other.forEach(o => { doc.highlights.splice(doc.highlights.indexOf(o), 1); HL.unpaint($('#prose'), o.id); });
    let a = anchor;
    if (same.length) {
      a = HL.mergeAnchor(anchor, same);
      const block = $(`#prose [data-bid="${CSS.escape(a.bid)}"]`);
      if (block) a.text = HL.blockText(block).slice(a.start, a.end);
      const keepNote = same.map(s => s.note).filter(Boolean).join(' · ');
      same.forEach(s => { doc.highlights.splice(doc.highlights.indexOf(s), 1); HL.unpaint($('#prose'), s.id); });
      const h = HL.makeHighlight({ ...a, color, note: keepNote });
      doc.highlights.push(h); created = h;
    } else {
      const h = HL.makeHighlight({ ...anchor, color });
      doc.highlights.push(h); created = h;
    }
  }
  window.getSelection()?.removeAllRanges();
  hidePopover();
  repaintHighlights();
  renderNotesPanel();
  $('#meta-hl').textContent = String(doc.highlights.length);
  $('#hl-count-dot').hidden = !doc.highlights.length;
  store.save(doc, { touch: false });
  return created;
}

function clearHighlightsAt() {
  const removed = [];
  for (const anchor of activeAnchors) {
    for (const o of HL.overlapping(doc.highlights, anchor)) {
      doc.highlights.splice(doc.highlights.indexOf(o), 1);
      HL.unpaint($('#prose'), o.id);
      removed.push(o);
    }
  }
  window.getSelection()?.removeAllRanges();
  hidePopover();
  if (removed.length) {
    repaintHighlights(); renderNotesPanel();
    $('#meta-hl').textContent = String(doc.highlights.length);
    $('#hl-count-dot').hidden = !doc.highlights.length;
    store.save(doc, { touch: false });
    toast(`Removed ${removed.length} highlight${removed.length === 1 ? '' : 's'}`, { icon: 'erase' });
  }
}

function removeHighlight(h) {
  doc.highlights.splice(doc.highlights.indexOf(h), 1);
  HL.unpaint($('#prose'), h.id);
  renderNotesPanel();
  $('#meta-hl').textContent = String(doc.highlights.length);
  $('#hl-count-dot').hidden = !doc.highlights.length;
  store.save(doc, { touch: false });
  toast('Highlight removed', { icon: 'erase', action: { label: 'Undo', fn: () => { doc.highlights.push(h); repaintHighlights(); renderNotesPanel(); store.save(doc, { touch: false }); } } });
}

function editNote(h) {
  const ta = el('textarea', { placeholder: 'What does this mean? Why does it matter?' });
  ta.value = h.note || '';
  const { close } = sheet({
    title: h.note ? 'Edit note' : 'Add a note',
    body: el('div', { class: 'note-editor', style: { '--h': String(HL.hueOf(h.color)) } },
      el('div', { class: 'note-quote', text: h.text }),
      ta,
      el('div', { class: 'opt-row' }, ...settings.HL_COLORS.map(c => el('button', {
        class: 'accent-dot' + (c.id === h.color ? ' is-on' : ''),
        style: { '--c': `hsl(${c.h} 90% 58%)`, flex: 'none' }, title: c.name,
        onclick: (e) => {
          h.color = c.id;
          e.currentTarget.parentElement.querySelectorAll('.accent-dot').forEach(d => d.classList.remove('is-on'));
          e.currentTarget.classList.add('is-on');
          e.currentTarget.closest('.note-editor').style.setProperty('--h', String(c.h));
        },
      }))),
    ),
    foot: [
      h.note ? el('button', { class: 'btn btn-danger', text: 'Remove note', onclick: () => { h.note = ''; close(); save(); } }) : null,
      el('button', { class: 'btn btn-outline', text: 'Cancel', onclick: () => close() }),
      el('button', { class: 'btn btn-primary', text: 'Save', onclick: () => { h.note = ta.value.trim(); close(); save(); } }),
    ].filter(Boolean),
  });
  setTimeout(() => ta.focus(), 80);
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { h.note = ta.value.trim(); close(); save(); }
  });
  function save() {
    repaintHighlights(); renderNotesPanel();
    store.save(doc, { touch: false });
    togglePanel('notes', true);
  }
}

function cardFromHighlight(h) {
  const q = el('textarea', { placeholder: 'Question', style: { minHeight: '80px' } });
  const a = el('textarea', { placeholder: 'Answer', style: { minHeight: '110px' } });
  a.value = h.text;
  q.value = h.note || '';
  const { close } = sheet({
    title: 'New flashcard',
    body: el('div', { class: 'note-editor' },
      el('div', { class: 'group' }, el('h4', { text: 'Question' }), q),
      el('div', { class: 'group' }, el('h4', { text: 'Answer' }), a),
      el('p', { class: 'hint', text: 'Cards you make here live alongside the ones from ::: quiz blocks, and come up in Study.' }),
    ),
    foot: [
      el('button', { class: 'btn btn-outline', text: 'Cancel', onclick: () => close() }),
      el('button', { class: 'btn btn-primary', text: 'Add card', onclick: () => {
        if (!q.value.trim() || !a.value.trim()) { toast('A card needs both a question and an answer', { kind: 'warn', icon: 'help' }); return; }
        doc.cards.push({ id: uid('card'), q: q.value.trim(), a: a.value.trim(), ease: 2.5, interval: 0, reps: 0, lapses: 0, due: 0, from: 'highlight' });
        store.save(doc, { touch: false });
        close(); toast('Flashcard added', { icon: 'cards' });
      } }),
    ],
  });
  setTimeout(() => q.focus(), 80);
}

/* ---------------- selection popover ---------------- */

function showPopover() {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return hidePopover();
  const prose = $('#prose');
  if (!prose.contains(sel.anchorNode)) return hidePopover();

  activeAnchors = HL.anchorsFromSelection(prose);
  if (!activeAnchors.length) return hidePopover();

  const pop = $('#sel-pop');
  const colors = $('#sel-colors');
  if (!colors.children.length) {
    settings.HL_COLORS.forEach(c => colors.append(el('button', {
      class: 'sel-swatch', style: { '--h': String(c.h) }, title: `${c.name} (${c.id})`,
      onmousedown: (e) => e.preventDefault(),
      onclick: () => addHighlight(c.id),
    })));
  }
  const existing = activeAnchors.flatMap(a => HL.overlapping(doc.highlights, a));
  $$('#sel-colors .sel-swatch').forEach((s, i) => s.classList.toggle('is-on', existing.some(h => h.color === i + 1)));

  pop.hidden = false;
  const r = sel.getRangeAt(0).getBoundingClientRect();
  const pr = pop.getBoundingClientRect();
  let left = r.left + r.width / 2 - pr.width / 2;
  let top = r.top - pr.height - 10;
  if (top < 60) top = r.bottom + 10;
  pop.style.left = clamp(left, 8, innerWidth - pr.width - 8) + 'px';
  pop.style.top = clamp(top, 8, innerHeight - pr.height - 8) + 'px';
}

function hidePopover() { $('#sel-pop').hidden = true; }

/* ---------------- progress & scroll ---------------- */

const saveProgress = debounce(() => { if (doc) store.saveSoon(doc); }, 900);

const updateProgress = throttle(() => {
  const main = $('#read-main');
  if (!main || !doc) return;

  paintBookChrome();
  let p, activeId = null;

  if (pager?.paged) {
    p = pager.progress();
    $('#page-count').textContent = pager.count > 1 ? `${pager.index + 1} / ${pager.count}` : '';
    $('#turn-prev').disabled = pager.index === 0;
    $('#turn-next').disabled = pager.index >= pager.count - 1;
    // the last heading that has already begun on, or before, this page
    for (const h of outlineData) {
      const node = document.getElementById(h.id);
      if (node && pager.pageOf(node) <= pager.index) activeId = h.id;
    }
  } else {
    const max = Math.max(1, main.scrollHeight - main.clientHeight);
    p = clamp(main.scrollTop / max, 0, 1);
    $('#read-progress-bar').style.width = (p * 100).toFixed(2) + '%';
    const top = main.getBoundingClientRect().top + 110;
    for (const h of outlineData) {
      const node = document.getElementById(h.id);
      if (node && node.getBoundingClientRect().top <= top) activeId = h.id;
    }
  }

  if (Math.abs(p - (doc.progress || 0)) > 0.005) { doc.progress = p; saveProgress(); }
  $$('#outline-list .o-item').forEach(b => b.classList.toggle('is-on', b.dataset.target === activeId));
}, 120);

/* ---------------- book chrome ----------------
   The running head and the folio belong to the frame, not to the sheet: the
   sheet slides sideways when you turn, and a page number that slid with it
   would be a page number for the wrong page.  A printed book leaves the
   opening page bare, so the running head only appears from page two on. */

/** Write only when it changes: this runs on every scroll frame. */
function setText(id, value) {
  const node = $(id);
  if (node && node.textContent !== value) node.textContent = value;
}

function paintBookChrome() {
  const frame = $('#page-frame');
  if (!frame) return;

  if (!pager?.paged) {
    frame.classList.remove('has-head');
    for (const id of ['#head-l', '#head-r', '#folio-l', '#folio-r']) setText(id, '');
    return;
  }

  // Verso carries the book, recto carries the chapter — a single page just
  // carries the book, centred.
  const title = (doc?.title || '').trim();
  const section = pager.cols > 1 ? sectionOnPage() : '';
  setText('#head-l', title);
  setText('#head-r', section === title ? '' : section);
  frame.classList.toggle('has-head', !!(title || section) && pager.index > 0);

  // In a spread each turn shows two leaves, so the folio counts leaves, not
  // turns — and a book with an odd number of them ends on a blank recto,
  // which a printed book leaves unnumbered.
  const cols = pager.cols;
  const first = pager.index * cols + 1;
  if (cols > 1) {
    setText('#folio-l', String(first));
    setText('#folio-r', first + 1 <= pager.leaves ? String(first + 1) : '');
  } else {
    setText('#folio-l', pager.count > 1 ? String(first) : '');
    setText('#folio-r', '');
  }
}

/** The last heading that has already begun on, or before, this page. */
function sectionOnPage() {
  if (!pager?.paged) return '';
  let text = '';
  for (const h of outlineData) {
    const node = document.getElementById(h.id);
    if (node && pager.pageOf(node) <= pager.index) text = h.text;
  }
  return text;
}

let turnFxTimer = 0;

/** A shadow sweeps across the block in the direction you turned. */
function playTurn(direction) {
  const frame = $('#page-frame');
  if (!frame || !direction || settings.get('motion') === 'off') return;
  frame.classList.remove('turning-next', 'turning-prev');
  void frame.offsetWidth;                       // restart the animation
  frame.classList.add(direction > 0 ? 'turning-next' : 'turning-prev');
  clearTimeout(turnFxTimer);
  turnFxTimer = setTimeout(() => frame.classList.remove('turning-next', 'turning-prev'), 1200);
}

/* ---------------- find in note ---------------- */

function openFind() {
  $('#find-bar').hidden = false;
  const i = $('#find-input');
  i.focus(); i.select();
}

function closeFind() {
  $('#find-bar').hidden = true;
  clearFind();
  findState = { q: '', hits: [], idx: -1 };
}

function clearFind() {
  $$('#prose .find-hit').forEach(span => {
    const p = span.parentNode;
    while (span.firstChild) p.insertBefore(span.firstChild, span);
    span.remove(); p.normalize();
  });
}

function runFind(q) {
  clearFind();
  findState.q = q; findState.hits = []; findState.idx = -1;
  if (!q || q.length < 2) { $('#find-count').textContent = '0/0'; return; }

  const prose = $('#prose');
  const walker = document.createTreeWalker(prose, NodeFilter.SHOW_TEXT, null);
  const needle = q.toLowerCase();
  const targets = [];
  let n;
  while ((n = walker.nextNode())) {
    const t = n.nodeValue.toLowerCase();
    let from = 0, i;
    while ((i = t.indexOf(needle, from)) >= 0) { targets.push({ node: n, i }); from = i + needle.length; }
  }
  // wrap from the end so earlier indices stay valid
  for (let k = targets.length - 1; k >= 0; k--) {
    const { node, i } = targets[k];
    const r = document.createRange();
    r.setStart(node, i); r.setEnd(node, i + q.length);
    const span = document.createElement('span');
    span.className = 'find-hit';
    try { r.surroundContents(span); findState.hits.unshift(span); } catch { /* skip */ }
  }
  $('#find-count').textContent = `${findState.hits.length ? 1 : 0}/${findState.hits.length}`;
  if (pager?.paged) pager.measure();
  if (findState.hits.length) stepFind(0);
}

function stepFind(delta) {
  if (!findState.hits.length) return;
  findState.hits.forEach(h => h.classList.remove('is-cur'));
  findState.idx = (findState.idx + delta + findState.hits.length) % findState.hits.length;
  const cur = findState.hits[findState.idx];
  cur.classList.add('is-cur');
  if (pager?.paged) pager.go(pager.pageOf(cur));
  else cur.scrollIntoView({ block: 'center', behavior: settings.get('motion') === 'off' ? 'auto' : 'smooth' });
  $('#find-count').textContent = `${findState.idx + 1}/${findState.hits.length}`;
}

/* ---------------- task checkboxes ---------------- */

function toggleTask(tickEl) {
  const all = $$('#prose li.task');
  const idx = all.indexOf(tickEl.closest('li.task'));
  if (idx < 0) return;
  let seen = -1;
  doc.markdown = doc.markdown.replace(/^(\s*(?:[-*+•]|\d+[.)])\s+)\[([ xX])\]/gm, (m, pre, mark) => {
    seen++;
    if (seen !== idx) return m;
    return `${pre}[${mark.toLowerCase() === 'x' ? ' ' : 'x'}]`;
  });
  store.invalidate(doc.id);
  store.save(doc);
  renderDoc();
}

/* ---------------- wiring ---------------- */

function bind() {
  if (bound) return;
  bound = true;

  const main = $('#read-main');
  main.addEventListener('scroll', updateProgress, { passive: true });
  $('#panel-scrim').addEventListener('click', closeOverlayPanels);

  pager = createPager({
    viewport: main,
    sheet: $('#paper'),
    onChange: ({ direction }) => { hidePopover(); playTurn(direction); paintBookChrome(); },
  });
  $('#turn-prev').addEventListener('click', () => { pager.prev(); updateProgress(); });
  $('#turn-next').addEventListener('click', () => { pager.next(); updateProgress(); });

  settings.onChange((_, patch) => {
    if ($('.view-reader').hidden) return;
    if ('flow' in patch) pager.setMode(settings.get('flow'));
    requestAnimationFrame(relayout);
  });

  bindSwipe();

  // focus-mode escape hatch
  $('.view-reader').append(el('div', { class: 'focus-exit' },
    el('button', { class: 'btn btn-icon btn-sm', title: 'Leave focus mode (F)', onclick: () => toggleFocus(false) },
      el('span', { class: 'i', dataset: { icon: 'focus' } }))));

  document.addEventListener('selectionchange', debounce(() => {
    if ($('.view-reader').hidden) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) { hidePopover(); return; }
    showPopover();
  }, 90));

  $('#prose').addEventListener('click', (e) => {
    const zoom = e.target.closest('img[data-zoom]');
    if (zoom) { lightbox(zoom.src, zoom.closest('figure')?.querySelector('figcaption')?.textContent || zoom.alt || ''); return; }
    const tick = e.target.closest('.tick');
    if (tick) { toggleTask(tick); return; }
    const q = e.target.closest('.quiz-q');
    if (q) { q.closest('.quiz').classList.toggle('is-open'); return; }
    const hl = e.target.closest('.hl');
    if (hl) {
      const h = doc.highlights.find(x => x.id === hl.dataset.hl);
      if (h) { togglePanel('notes', true); renderNotesPanel(); jumpToHighlight(h); }
    }
  });

  $('#prose').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      const q = e.target.closest('.quiz-q');
      if (q) { e.preventDefault(); q.closest('.quiz').classList.toggle('is-open'); }
    }
  });

  $('#sel-pop').addEventListener('mousedown', (e) => e.preventDefault());
  $$('#sel-pop [data-sel]').forEach(b => b.addEventListener('click', () => {
    const what = b.dataset.sel;
    if (what === 'copy') {
      const text = activeAnchors.map(a => a.text).join('\n');
      copyText(text).then(() => toast('Copied', { icon: 'copy' }));
      hidePopover(); window.getSelection()?.removeAllRanges();
    }
    if (what === 'clear') clearHighlightsAt();
    if (what === 'note') { const h = addHighlight(existingColor() || 1); if (h) editNote(h); }
    if (what === 'card') {
      const text = activeAnchors.map(a => a.text).join(' ');
      const h = doc.highlights.find(x => x.text === text) || { text, color: 1, note: '' };
      cardFromHighlight(h);
      hidePopover(); window.getSelection()?.removeAllRanges();
    }
  }));

  // doc bar
  $('.view-reader .doc-bar').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === 'back') back();
    if (act === 'toggle-outline') togglePanel('outline');
    if (act === 'toggle-notes') { togglePanel('notes'); renderNotesPanel(); }
    if (act === 'edit') go('editor', { id: doc.id });
    if (act === 'find') openFind();
    if (act === 'focus') toggleFocus();
    if (act === 'study-doc') go('study', { id: doc.id });
    if (act === 'appearance') actions.openAppearance?.();
    if (act === 'doc-menu') docMenu(btn);
  });
  $$('.outline [data-act="toggle-outline"], .notes-panel [data-act="toggle-notes"]').forEach(b =>
    b.addEventListener('click', () => togglePanel(b.dataset.act === 'toggle-outline' ? 'outline' : 'notes', false)));

  // find bar
  $('#find-input').addEventListener('input', debounce((e) => runFind(e.target.value), 160));
  $('#find-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); stepFind(e.shiftKey ? -1 : 1); }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeFind(); $('#read-main').focus?.(); }
  });
  $('#find-bar').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    if (b.dataset.act === 'find-next') stepFind(1);
    if (b.dataset.act === 'find-prev') stepFind(-1);
    if (b.dataset.act === 'find-close') closeFind();
  });

  addEventListener('resize', debounce(() => { applyPanels(); relayout(); }, 200));
  // web fonts and images settling change where the text breaks
  addEventListener('load', () => relayout());
}

const existingColor = () => {
  for (const a of activeAnchors) {
    const o = HL.overlapping(doc.highlights, a);
    if (o.length) return o[0].color;
  }
  return null;
};

function toggleFocus(force) {
  const v = $('.view-reader');
  const on = force === undefined ? !v.classList.contains('is-focus') : force;
  v.classList.toggle('is-focus', on);
  if (on) toast('Focus mode — press F or Esc to leave', { icon: 'focus', ms: 1800 });
}

function docMenu(anchor) {
  menu([
    { label: 'Edit note', icon: 'pencil', sub: '⌘E', fn: () => go('editor', { id: doc.id }) },
    { label: doc.pinned ? 'Unpin' : 'Pin to top', icon: 'pin', fn: async () => { doc.pinned = !doc.pinned; await store.save(doc, { touch: false }); } },
    { label: 'Appearance', icon: 'sliders', sub: '⌘,', fn: () => actions.openAppearance?.() },
    '-',
    { label: 'Find in note', icon: 'search', sub: '⌘F', fn: openFind },
    { label: 'Outline', icon: 'outline', sub: '⌘\\', fn: () => togglePanel('outline') },
    { label: 'Highlights & notes', icon: 'marker', sub: '⌘J', fn: () => { togglePanel('notes'); renderNotesPanel(); } },
    { label: 'Study this note', icon: 'cards', sub: '⌘D', fn: () => go('study', { id: doc.id }) },
    '-',
    { label: 'Copy as Markdown', icon: 'copy', fn: () => copyText(doc.markdown).then(() => toast('Markdown copied', { icon: 'copy' })) },
    { label: 'Export…', icon: 'download', fn: () => actions.exportDoc?.(doc) },
    { label: 'Print / save as PDF', icon: 'print', fn: () => actions.printDoc?.(doc) },
    '-',
    { label: 'Delete note', icon: 'trash', danger: true, fn: () => confirmDialog({
        title: 'Delete this note?',
        message: `“${doc.title}” will be removed from this device. This cannot be undone.`,
        confirmLabel: 'Delete', danger: true,
        onConfirm: async () => { await store.remove(doc.id); toast('Note deleted', { icon: 'trash' }); go('library'); },
      }) },
  ], { anchor });
}

/* ---------------- touch gestures ---------------- */

const EDGE = 30;        // how close to the side a swipe has to start
const TRAVEL = 55;      // how far it has to go
const SLOP = 34;        // how much vertical drift is still a horizontal swipe

/**
 * Swipe in from an edge to open the outline or the notes panel, and swipe an
 * open panel away again. Only on touch, and only when the panels are floating
 * over the page — otherwise it would fight with scrolling and text selection.
 */
function bindSwipe() {
  const shell = $('.read-shell');
  let x0 = 0, y0 = 0, t0 = 0, live = false;

  shell.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) { live = false; return; }
    const t = e.touches[0];
    x0 = t.clientX; y0 = t.clientY; t0 = Date.now();
    const open = shell.classList.contains('show-outline') || shell.classList.contains('show-notes');
    const edge = x0 <= EDGE || x0 >= innerWidth - EDGE;
    // pages can be turned anywhere; panels only from the edges, and only
    // while they float over the text
    live = pager?.paged ? true : (innerWidth <= OVERLAY_AT && (open || edge));
  }, { passive: true });

  shell.addEventListener('touchend', (e) => {
    if (!live) return;
    live = false;
    const t = e.changedTouches[0];
    const dx = t.clientX - x0, dy = t.clientY - y0;
    if (Math.abs(dy) > SLOP || Math.abs(dx) < TRAVEL) return;
    if (Date.now() - t0 > 700) return;

    const outlineOpen = shell.classList.contains('show-outline');
    const notesOpen = shell.classList.contains('show-notes');
    const fromEdge = x0 <= EDGE || x0 >= innerWidth - EDGE;

    if (pager?.paged && !outlineOpen && !notesOpen && !fromEdge) {
      dx < 0 ? pager.next() : pager.prev();
      updateProgress();
      return;
    }

    if (dx > 0) {
      if (notesOpen) closeOverlayPanels();
      else if (!outlineOpen && x0 <= EDGE) togglePanel('outline', true);
    } else {
      if (outlineOpen) closeOverlayPanels();
      else if (!notesOpen && x0 >= innerWidth - EDGE) { togglePanel('notes', true); renderNotesPanel(); }
    }
  }, { passive: true });
}

/* ---------------- shortcuts exposed to main ---------------- */

export const keys = {
  highlight(n) { if (activeAnchors.length) addHighlight(n); },
  note() { if (activeAnchors.length) { const h = addHighlight(existingColor() || 1); if (h) editNote(h); } },
  card() { if (activeAnchors.length) $('#sel-pop [data-sel="card"]').click(); },
  clear() { if (activeAnchors.length) clearHighlightsAt(); },
  find: openFind,
  closeFind,
  findOpen: () => !$('#find-bar').hidden,
  closePanels: closeOverlayPanels,
  focus: toggleFocus,
  isFocus: () => $('.view-reader').classList.contains('is-focus'),
  outline: () => togglePanel('outline'),
  notes: () => { togglePanel('notes'); renderNotesPanel(); },
  scroll(delta) {
    if (pager?.paged) { delta > 0 ? pager.next() : pager.prev(); updateProgress(); return; }
    $('#read-main').scrollBy({ top: delta, behavior: 'smooth' });
  },
  turn(dir) {
    if (!pager?.paged) return false;
    dir > 0 ? pager.next() : pager.prev();
    updateProgress();
    return true;
  },
  paged: () => !!pager?.paged,
  hasSelection: () => activeAnchors.length > 0,
  step(dir) {
    const { prev, next } = neighbours();
    const target = dir < 0 ? prev : next;
    if (!target) { toast(dir < 0 ? 'First note in this subject' : 'Last note in this subject', { icon: 'book', kind: 'warn', ms: 1400 }); return; }
    go('reader', { id: target.id });
  },
};
