/* Lucid — spaced repetition over ::: quiz blocks and cards made from highlights. */

import { $, $$, el, shuffle, uid, pluralize } from '../core/util.js';
import * as store from '../core/store.js';
import * as settings from '../core/settings.js';
import { inline } from '../parse/lmd.js';
import { toast } from '../ui/ui.js';
import { go, back } from '../core/router.js';

const DAY = 86400000;
let queue = [];
let idx = 0;
let shown = false;
let scope = null;      // doc id, or null for everything
let bound = false;
let stats = { done: 0, again: 0 };

export const view = {
  async mount({ id }) {
    bind();
    scope = id || null;
    await build();
    $('#study-title').textContent = scope ? (store.get(scope)?.title || 'Study') : 'Study everything due';
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

async function build({ all = false } = {}) {
  const docs = scope ? [store.get(scope)].filter(Boolean) : store.all();
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
  $('#study-counter').textContent = total ? `${Math.min(idx + 1, total)} / ${total}` : '';

  if (done) {
    const sub = total
      ? `${pluralize(stats.done, 'card')} reviewed${stats.again ? `, ${stats.again} to see again` : ''}. Nice.`
      : scope
        ? 'This note has no cards yet. Add a ::: quiz block, or highlight something and turn it into a card.'
        : 'No cards are due right now. Come back later, or study everything anyway.';
    $('#study-done-sub').textContent = sub;
    const again = $('[data-act="study-again"]');
    if (again) again.textContent = total ? 'Study again' : 'Study everything anyway';
    return;
  }

  const { doc, card } = queue[idx];
  $('#flash-q').innerHTML = inline(card.q, { img: s => store.resolveImage(s) });
  $('#flash-a').innerHTML = renderAnswer(card.a);
  $('#study-title').textContent = scope ? doc.title : `Study · ${doc.title}`;
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

export function dueSummary() {
  const now = Date.now();
  let due = 0, total = 0;
  for (const doc of store.all()) {
    for (const c of doc.cards || []) { total++; if ((c.due || 0) <= now) due++; }
  }
  return { due, total };
}
