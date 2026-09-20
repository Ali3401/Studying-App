/* Lucid — spaced repetition over ::: quiz blocks and cards made from highlights. */

import { $, $$, el, add, shuffle, uid, pluralize, fmtUntil, todayStr } from '../core/util.js';
import * as store from '../core/store.js';
import * as settings from '../core/settings.js';
import { inline } from '../parse/lmd.js';
import { toast } from '../ui/ui.js';
import { go, back } from '../core/router.js';

const DAY = 86400000;
let queue = [];
let idx = 0;
let shown = false;
let scope = null;      // doc id, or null
let subject = null;    // subject name, or null for everything
let bound = false;
let stats = { done: 0, again: 0 };

export const view = {
  async mount(params = {}) {
    bind();
    scope = params.id || null;
    subject = params.subject || null;
    await build();
    $('#study-title').textContent = scopeName();
    next(true);
  },
  async unmount() { await store.flush(); },
};

/* ---------------- building the queue ---------------- */

/** Make sure every ::: quiz question exists as a schedulable card. */
export function syncCards(doc) {
  const d = store.derived(doc);
  const wanted = d.quiz.filter(q => q.q && q.a);
  const byQ = new Map(doc.cards.filter(c => c.from === 'quiz').map(c => [c.q, c]));
  let changed = false;

  for (const q of wanted) {
    const hit = byQ.get(q.q);
    if (hit) { if (hit.a !== q.a) { hit.a = q.a; changed = true; } byQ.delete(q.q); }
    else {
      doc.cards.push({ id: uid('card'), q: q.q, a: q.a, ease: 2.5, interval: 0, reps: 0, lapses: 0, due: 0, from: 'quiz' });
      changed = true;
    }
  }
  // questions removed from the note lose their card
  for (const stale of byQ.values()) {
    doc.cards.splice(doc.cards.indexOf(stale), 1);
    changed = true;
  }
  if (changed) store.saveSoon(doc);
  return doc.cards;
}

const scopeName = () =>
  scope ? (store.get(scope)?.title || 'Study')
    : subject ? `Study ${subject}`
    : 'Study everything due';

function scopedDocs() {
  if (scope) return [store.get(scope)].filter(Boolean);
  if (subject) return store.all().filter(d => (d.subject || '').trim() === subject);
  return store.all();
}

async function build({ all = false } = {}) {
  const docs = scopedDocs();
  docs.forEach(syncCards);
  const now = Date.now();
  const items = [];
  for (const doc of docs) {
    for (const card of doc.cards) {
      if (all || (card.due || 0) <= now) items.push({ doc, card });
    }
  }
  items.sort((a, b) => (a.card.due || 0) - (b.card.due || 0));
  queue = items.length > 3 ? shuffle(items) : items;
  idx = 0;
  stats = { done: 0, again: 0 };
  return queue.length;
}

/* ---------------- presenting ---------------- */

function next(first = false) {
  shown = false;
  const total = queue.length;
  const done = idx >= total;

  $('#flash').hidden = done;
  $('#study-done').hidden = !done;
  $('#flash-grades').hidden = true;
  $('#flash-actions').hidden = false;
  $('#flash-a-wrap').hidden = true;

  $('#study-bar').style.width = total ? `${Math.round((idx / total) * 100)}%` : '0%';
  $('#study-counter').textContent = done || !total ? '' : `${Math.min(idx + 1, total)} / ${total}`;

  if (done) {
    const held = scopedDocs().reduce((n, d) => n + (d.cards || []).length + pendingQuizCount(d), 0);
    const nextUp = scopedDocs()
      .flatMap(d => d.cards || [])
      .map(c => c.due || 0)
      .filter(d => d > Date.now())
      .sort((a, b) => a - b)[0];
    const here = scope ? 'this note' : subject || 'your library';

    const sub = total
      ? `${pluralize(stats.done, 'card')} reviewed${stats.again ? `, ${stats.again} to see again` : ''}. Nice.`
      : held
        ? `Nothing is due in ${here} right now${nextUp ? ` — the next card comes back ${fmtUntil(nextUp)}` : ''}.`
        : scope
          ? 'This note has no cards yet. Add a ::: quiz block, or highlight something and turn it into a card.'
          : `Nothing in ${here} has cards yet. Add a ::: quiz block to a note, or highlight something and turn it into a card.`;
    $('#study-title').textContent = scopeName();
    $('#study-done-sub').textContent = sub;
    const again = $('[data-act="study-again"]');
    if (again) again.textContent = total ? 'Study again' : (scope || subject) ? 'Study it all anyway' : 'Study everything anyway';
    renderUpNext();
    return;
  }

  const { doc, card } = queue[idx];
  $('#flash-q').innerHTML = inline(card.q, { img: s => store.resolveImage(s) });
  $('#flash-a').innerHTML = renderAnswer(card.a);
  $('#study-title').textContent = scope ? doc.title : `${scopeName()} · ${doc.title}`;
  if (first) $('#study-bar').style.width = '0%';
}

function renderAnswer(a) {
  const lines = String(a).split('\n').filter(l => l.trim());
  if (lines.length > 1 && lines.every(l => /^\s*[-*•]\s+/.test(l))) {
    return '<ul class="prose-inline">' + lines.map(l =>
      `<li>${inline(l.replace(/^\s*[-*•]\s+/, ''), {})}</li>`).join('') + '</ul>';
  }
  return lines.map(l => `<p>${inline(l, { img: s => store.resolveImage(s) })}</p>`).join('');
}

function reveal() {
  if (shown) return;
  shown = true;
  $('#flash-a-wrap').hidden = false;
  $('#flash-actions').hidden = true;
  $('#flash-grades').hidden = false;
}

/* ---------------- streak ---------------- */

const KEEP_DAYS = 400;

/** Note that a card was graded today. */
function recordReview() {
  const today = todayStr();
  const days = (settings.get('studyDays') || []).slice();
  if (days[days.length - 1] !== today) days.push(today);
  const counts = { ...(settings.get('reviewCounts') || {}) };
  counts[today] = (counts[today] || 0) + 1;

  // keep it bounded
  const trimmed = days.slice(-KEEP_DAYS);
  for (const k of Object.keys(counts)) if (!trimmed.includes(k)) delete counts[k];
  settings.set({ studyDays: trimmed, reviewCounts: counts }, true);
}

const dayBefore = (iso, n = 1) => {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};

/**
 * Consecutive days ending today, or ending yesterday — a streak you have not
 * broken yet, just not continued. Returns 0 once a day has been missed.
 */
export function streak(history = settings.get('studyDays'), today = todayStr()) {
  const days = new Set(history || []);
  if (!days.size) return { days: 0, today: false };
  const studiedToday = days.has(today);
  let cursor = studiedToday ? today : dayBefore(today);
  if (!days.has(cursor)) return { days: 0, today: false };
  let n = 0;
  while (days.has(cursor)) { n++; cursor = dayBefore(cursor); }
  return { days: n, today: studiedToday };
}

export const reviewedToday = () => (settings.get('reviewCounts') || {})[todayStr()] || 0;

/** What is waiting after this session — the whole library, not just the scope. */
function renderUpNext() {
  const wrap = $('#study-upnext');
  if (!wrap) return;
  wrap.innerHTML = '';

  const all = store.all();
  const { due, total, soon } = dueSummary(all);
  const next = all.flatMap(d => d.cards || []).map(c => c.due || 0).filter(d => d > Date.now()).sort((a, b) => a - b)[0];

  if (!total) { wrap.hidden = true; return; }
  wrap.hidden = false;

  const run = streak();
  add(wrap,
    el('div', { class: 'stat-grid' },
      el('div', { class: 'stat' }, el('b', { text: String(due) }), el('span', { text: 'due now' })),
      el('div', { class: 'stat' }, el('b', { text: String(soon) }), el('span', { text: 'this week' })),
      el('div', { class: 'stat' }, el('b', { text: String(total) }), el('span', { text: 'cards in total' })),
      run.days
        ? el('div', { class: 'stat stat-streak' },
            el('b', {}, el('span', { class: 'i', dataset: { icon: 'flame' } }), el('span', { text: String(run.days) })),
            el('span', { text: run.days === 1 ? 'day' : 'days in a row' }))
        : null,
    ),
    reviewedToday() ? el('p', { class: 'hint', style: { textAlign: 'center' }, text: `${pluralize(reviewedToday(), 'card')} reviewed today.` }) : null,
    next && !due ? el('p', { class: 'hint', style: { textAlign: 'center' }, text: `The next card comes back ${fmtUntil(next)}.` }) : null,
  );

  const others = dueBySubject().filter(s => s.name !== subject);
  if (others.length) {
    add(wrap, el('div', { class: 'upnext-row' },
      ...others.slice(0, 4).map(s => el('button', {
        class: 'chip', onclick: () => { scope = null; subject = s.name; view.mount({ subject: s.name }); },
      }, el('span', { text: s.name }), el('span', { class: 'n', text: String(s.due) })))));
  }
}

/* ---------------- scheduling (SM-2, lightly tuned) ---------------- */

function grade(q) {
  if (!shown) { reveal(); return; }
  const entry = queue[idx];
  if (!entry) return;
  const { doc, card } = entry;
  const now = Date.now();

  card.reps = (card.reps || 0) + 1;
  card.ease = card.ease || 2.5;

  if (q === 1) {
    card.lapses = (card.lapses || 0) + 1;
    card.ease = Math.max(1.3, card.ease - 0.2);
    card.interval = 0;
    card.due = now + 6 * 60000;                       // back in a few minutes
    queue.push(entry);                                // and again this session
    stats.again++;
  } else if (q === 2) {
    card.ease = Math.max(1.3, card.ease - 0.15);
    card.interval = card.interval ? Math.max(1, card.interval * 1.2) : 1;
    card.due = now + card.interval * DAY;
  } else if (q === 3) {
    card.interval = card.interval ? card.interval * card.ease : (card.reps === 1 ? 1 : 3);
    card.due = now + card.interval * DAY;
  } else {
    card.ease = Math.min(3.2, card.ease + 0.12);
    card.interval = card.interval ? card.interval * card.ease * 1.25 : 4;
    card.due = now + card.interval * DAY;
  }
  card.interval = Math.round(card.interval * 100) / 100;
  card.lastGrade = q;
  card.reviewedAt = now;

  store.saveSoon(doc);
  recordReview();
  stats.done++;
  idx++;
  next();
}

/* ---------------- wiring ---------------- */

function bind() {
  if (bound) return;
  bound = true;

  $('#flash-card').addEventListener('click', () => reveal());
  $('#flash-actions').addEventListener('click', (e) => { if (e.target.closest('[data-grade]')) reveal(); });
  $('#flash-grades').addEventListener('click', (e) => {
    const b = e.target.closest('[data-grade]');
    if (b) grade(+b.dataset.grade);
  });

  $('.view-study').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    if (b.dataset.act === 'study-back') back();
    if (b.dataset.act === 'study-shuffle') { queue = shuffle(queue.slice(idx)); idx = 0; next(); toast('Shuffled', { icon: 'shuffle' }); }
    if (b.dataset.act === 'study-again') { await build({ all: true }); next(true); }
  });
}

export const keys = {
  space() { shown ? grade(3) : reveal(); },
  grade,
  reveal,
  isShown: () => shown,
  skip() { if (idx < queue.length) { idx++; next(); } },
};

/**
 * Questions in ::: quiz blocks that have not been turned into cards yet.
 * They only become real cards when a study session starts, so anything
 * counting what is waiting has to include them.
 */
export function pendingQuizCount(doc) {
  const have = new Set((doc.cards || []).filter(c => c.from === 'quiz').map(c => c.q));
  return store.derived(doc).quiz.filter(q => q.q && q.a && !have.has(q.q)).length;
}

/** Cards ready to review in one note, counting the ones not yet created. */
export function dueCountFor(doc, now = Date.now()) {
  return (doc.cards || []).filter(c => (c.due || 0) <= now).length + pendingQuizCount(doc);
}

export function dueSummary(docs = store.all()) {
  const now = Date.now();
  const week = now + 7 * 86400000;
  let due = 0, total = 0, soon = 0;
  for (const doc of docs) {
    const pending = pendingQuizCount(doc);
    due += pending; total += pending;
    for (const c of doc.cards || []) {
      total++;
      const d = c.due || 0;
      if (d <= now) due++;
      else if (d <= week) soon++;
    }
  }
  return { due, total, soon };
}

/** Cards due, per subject — used by the library and the palette. */
export function dueBySubject() {
  const now = Date.now();
  const m = new Map();
  for (const doc of store.all()) {
    const key = (doc.subject || '').trim();
    if (!key) continue;
    const n = dueCountFor(doc, now);
    if (n) m.set(key, (m.get(key) || 0) + n);
  }
  return Array.from(m, ([name, due]) => ({ name, due })).sort((a, b) => b.due - a.due);
}
