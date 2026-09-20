/* Lucid — document store: in-memory cache over IndexedDB, plus image handling. */

import * as db from './db.js';
import { uid, debounce, countWords } from './util.js';
import { parse, splitFrontmatter, buildFrontmatter, quizItems } from '../parse/lmd.js';
import { textOf, excerpt } from '../parse/render.js';

const docs = new Map();          // id -> doc
const listeners = new Set();
const imgURLs = new Map();       // imageId -> objectURL
const derivedCache = new Map();  // id -> { stamp, parsed, text, excerpt }

export const onChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = (type, doc) => listeners.forEach(fn => fn(type, doc));

export function newDoc(patch = {}) {
  const now = Date.now();
  return {
    id: uid('doc'),
    title: 'Untitled note',
    subject: '',
    tags: [],
    emoji: '',
    accent: null,
    markdown: '',
    source: 'paste',
    createdAt: now,
    updatedAt: now,
    openedAt: 0,
    pinned: false,
    archived: false,
    progress: 0,
    highlights: [],
    cards: [],
    images: [],
    ...patch,
  };
}

export async function init() {
  const list = await db.allDocs();
  list.forEach(d => docs.set(d.id, normalize(d)));
  return list.length;
}

function normalize(d) {
  d.tags = Array.isArray(d.tags) ? d.tags : [];
  d.highlights = Array.isArray(d.highlights) ? d.highlights : [];
  d.cards = Array.isArray(d.cards) ? d.cards : [];
  d.images = Array.isArray(d.images) ? d.images : [];
  d.progress = Number(d.progress) || 0;
  d.pinned = !!d.pinned;
  d.archived = !!d.archived;
  return d;
}

export const all = () => Array.from(docs.values()).filter(d => !d.archived);
export const allIncludingArchived = () => Array.from(docs.values());
export const get = (id) => docs.get(id) || null;
export const count = () => docs.size;

export async function save(doc, { touch = true } = {}) {
  if (touch) doc.updatedAt = Date.now();
  docs.set(doc.id, doc);
  derivedCache.delete(doc.id);
  await db.putDoc(JSON.parse(JSON.stringify(doc)));
  emit('save', doc);
  return doc;
}

const queued = new Map();
export const saveSoon = (doc) => {
  queued.set(doc.id, doc);
  flushSoon();
};
const flushSoon = debounce(async () => {
  const list = Array.from(queued.values());
  queued.clear();
  for (const d of list) await save(d);
}, 600);

export async function flush() { flushSoon.flush(); }

export async function create(patch = {}) {
  const d = newDoc(patch);
  await save(d);
  emit('create', d);
  return d;
}

export async function remove(id) {
  const d = docs.get(id);
  docs.delete(id);
  derivedCache.delete(id);
  await db.delDoc(id);
  if (d) for (const imgId of d.images || []) await releaseImage(imgId, id);
  emit('delete', d);
}

export async function duplicate(id) {
  const src = docs.get(id);
  if (!src) return null;
  const copy = newDoc({
    ...JSON.parse(JSON.stringify(src)),
    id: uid('doc'),
    title: src.title + ' (copy)',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    openedAt: 0,
  });
  await save(copy);
  emit('create', copy);
  return copy;
}

/* ---------------- derived data (memoised per markdown revision) ---------------- */

export function derived(doc) {
  const stamp = doc.markdown.length + ':' + doc.updatedAt;
  const hit = derivedCache.get(doc.id);
  if (hit && hit.stamp === stamp) return hit;
  const parsed = parse(doc.markdown);
  const text = textOf(parsed.blocks);
  const rec = {
    stamp,
    meta: parsed.meta,
    blocks: parsed.blocks,
    text,
    excerpt: excerpt(parsed.blocks),
    words: countWords(text),
    quiz: quizItems(parsed.blocks),
  };
  derivedCache.set(doc.id, rec);
  return rec;
}

export const invalidate = (id) => derivedCache.delete(id);

/** Apply frontmatter found in the markdown onto the doc's own fields. */
export function syncMetaFromMarkdown(doc) {
  const { meta } = splitFrontmatter(doc.markdown);
  let changed = false;
  if (meta.title && meta.title !== doc.title) { doc.title = meta.title; changed = true; }
  if (meta.subject && meta.subject !== doc.subject) { doc.subject = meta.subject; changed = true; }
  if (meta.emoji && meta.emoji !== doc.emoji) { doc.emoji = meta.emoji; changed = true; }
  if (meta.accent && meta.accent !== doc.accent) { doc.accent = meta.accent; changed = true; }
  if (meta.tags && meta.tags.join() !== (doc.tags || []).join()) { doc.tags = meta.tags; changed = true; }
  return changed;
}

/** Write the doc's fields back into the markdown frontmatter. */
export function writeFrontmatter(doc) {
  const { body } = splitFrontmatter(doc.markdown);
  const fm = buildFrontmatter({
    title: doc.title, subject: doc.subject, tags: doc.tags, emoji: doc.emoji, accent: doc.accent,
  });
  doc.markdown = fm + body.replace(/^\n+/, '');
  return doc.markdown;
}

export function subjects() {
  const m = new Map();
  for (const d of all()) {
    const s = (d.subject || '').trim();
    if (!s) continue;
    m.set(s, (m.get(s) || 0) + 1);
  }
  return Array.from(m, ([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
}

export function tags() {
  const m = new Map();
  for (const d of all()) for (const t of d.tags || []) m.set(t, (m.get(t) || 0) + 1);
  return Array.from(m, ([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n);
}

/* ---------------- images ---------------- */

export async function addImage(blob, docId) {
  const id = uid('img');
  await db.putImage(id, blob, { docId });
  const url = URL.createObjectURL(blob);
  imgURLs.set(id, url);
  const doc = docs.get(docId);
  if (doc && !doc.images.includes(id)) doc.images.push(id);
  return { id, url, ref: `img:${id}` };
}

/** Resolve `img:ID` / data: / http(s): references for the renderer. */
export function resolveImage(src) {
  if (!src) return '';
  if (src.startsWith('img:')) {
    const id = src.slice(4);
    return imgURLs.get(id) || `#pending-${id}`;
  }
  if (/^(https?:|data:|blob:|\.?\/)/i.test(src)) return src;
  return src;
}

/** Load every image referenced by a doc into the object-URL cache. */
export async function preloadImages(doc) {
  const ids = new Set(doc.images || []);
  const re = /img:([A-Za-z0-9_]+)/g;
  let m;
  while ((m = re.exec(doc.markdown))) ids.add(m[1]);
  const missing = Array.from(ids).filter(id => !imgURLs.has(id));
  await Promise.all(missing.map(async id => {
    const rec = await db.getImage(id);
    if (rec?.blob) imgURLs.set(id, URL.createObjectURL(rec.blob));
  }));
  return ids.size;
}

export const imageURL = (id) => imgURLs.get(id) || null;

async function releaseImage(id, docId) {
  const stillUsed = Array.from(docs.values()).some(d => d.id !== docId && (d.images || []).includes(id));
  if (stillUsed) return;
  const url = imgURLs.get(id);
  if (url) { URL.revokeObjectURL(url); imgURLs.delete(id); }
  await db.delImage(id);
}

/** Delete stored images no document references any more. */
export async function pruneImages() {
  const used = new Set();
  for (const d of docs.values()) {
    (d.images || []).forEach(i => used.add(i));
    const re = /img:([A-Za-z0-9_]+)/g;
    let m; while ((m = re.exec(d.markdown))) used.add(m[1]);
  }
  const stored = await db.allImages();
  let freed = 0;
  for (const rec of stored) {
    if (!used.has(rec.id)) { await db.delImage(rec.id); freed += rec.size || 0; }
  }
  return freed;
}

/* ---------------- backup ---------------- */

export async function exportBackup() {
  const imgs = await db.allImages();
  const images = [];
  for (const rec of imgs) {
    const blob = rec.blob || (rec.dataUrl ? await (await fetch(rec.dataUrl)).blob() : null);
    if (!blob) continue;
    const dataUrl = await new Promise(r => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(blob); });
    images.push({ id: rec.id, dataUrl });
  }
  return {
    app: 'lucid',
    version: 1,
    exportedAt: new Date().toISOString(),
    docs: Array.from(docs.values()),
    images,
  };
}

export async function importBackup(data, { merge = true } = {}) {
  if (!data || data.app !== 'lucid') throw new Error('Not a Lucid backup file');
  if (!merge) { await db.wipeAll(); docs.clear(); imgURLs.clear(); }
  let added = 0;
  for (const img of data.images || []) {
    const blob = await (await fetch(img.dataUrl)).blob();
    await db.putImage(img.id, blob, {});
    imgURLs.set(img.id, URL.createObjectURL(blob));
  }
  for (const d of data.docs || []) {
    const doc = normalize({ ...d });
    if (merge && docs.has(doc.id)) doc.id = uid('doc');
    docs.set(doc.id, doc);
    await db.putDoc(JSON.parse(JSON.stringify(doc)));
    added++;
  }
  emit('bulk');
  return added;
}

export const storageEstimate = db.storageEstimate;
export const usingFallback = db.usingFallback;
export { db };
