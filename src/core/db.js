/* Lucid — IndexedDB persistence (docs + images), with a localStorage fallback. */

const DB_NAME = 'lucid-db';
const DB_VERSION = 1;
const STORE_DOCS = 'docs';
const STORE_IMGS = 'images';
const STORE_META = 'meta';

let dbp = null;
let fallback = false;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    let req;
    try { req = indexedDB.open(DB_NAME, DB_VERSION); }
    catch (e) { reject(e); return; }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_DOCS)) {
        const s = db.createObjectStore(STORE_DOCS, { keyPath: 'id' });
        s.createIndex('updatedAt', 'updatedAt');
        s.createIndex('subject', 'subject');
      }
      if (!db.objectStoreNames.contains(STORE_IMGS)) db.createObjectStore(STORE_IMGS, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORE_META)) db.createObjectStore(STORE_META, { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('IndexedDB blocked'));
  }).catch(err => {
    console.warn('[lucid] IndexedDB unavailable, using localStorage', err);
    fallback = true;
    return null;
  });
  return dbp;
}

function tx(db, store, mode = 'readonly') {
  return db.transaction(store, mode).objectStore(store);
}

const wrap = (req) => new Promise((res, rej) => {
  req.onsuccess = () => res(req.result);
  req.onerror = () => rej(req.error);
});

/* ---------- localStorage fallback ---------- */
const LS_KEY = 'lucid.fallback.';
const lsGetAll = (store) => {
  try { return JSON.parse(localStorage.getItem(LS_KEY + store) || '[]'); } catch { return []; }
};
const lsSetAll = (store, arr) => {
  try { localStorage.setItem(LS_KEY + store, JSON.stringify(arr)); } catch (e) { console.warn('[lucid] storage full', e); }
};

/* ---------- public API ---------- */

export async function allDocs() {
  const db = await open();
  if (!db) return lsGetAll(STORE_DOCS);
  return wrap(tx(db, STORE_DOCS).getAll());
}

export async function getDoc(id) {
  const db = await open();
  if (!db) return lsGetAll(STORE_DOCS).find(d => d.id === id) || null;
  return wrap(tx(db, STORE_DOCS, 'readonly').get(id));
}

export async function putDoc(doc) {
  const db = await open();
  if (!db) {
    const all = lsGetAll(STORE_DOCS);
    const i = all.findIndex(d => d.id === doc.id);
    if (i >= 0) all[i] = doc; else all.push(doc);
    lsSetAll(STORE_DOCS, all);
    return doc;
  }
  const store = tx(db, STORE_DOCS, 'readwrite');
  await wrap(store.put(doc));
  return doc;
}

export async function putDocs(docs) {
  const db = await open();
  if (!db) { lsSetAll(STORE_DOCS, docs); return; }
  const t = db.transaction(STORE_DOCS, 'readwrite');
  const s = t.objectStore(STORE_DOCS);
  docs.forEach(d => s.put(d));
  return new Promise((res, rej) => { t.oncomplete = res; t.onerror = () => rej(t.error); });
}

export async function delDoc(id) {
  const db = await open();
  if (!db) { lsSetAll(STORE_DOCS, lsGetAll(STORE_DOCS).filter(d => d.id !== id)); return; }
  await wrap(tx(db, STORE_DOCS, 'readwrite').delete(id));
}

/* ---------- images ---------- */

export async function putImage(id, blob, meta = {}) {
  const db = await open();
  const rec = { id, blob, type: blob.type, size: blob.size, ...meta, createdAt: Date.now() };
  if (!db) {
    const all = lsGetAll(STORE_IMGS);
    const dataUrl = await new Promise(r => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(blob); });
    all.push({ id, dataUrl, size: blob.size, type: blob.type, createdAt: rec.createdAt });
    lsSetAll(STORE_IMGS, all);
    return rec;
  }
  await wrap(tx(db, STORE_IMGS, 'readwrite').put(rec));
  return rec;
}

export async function getImage(id) {
  const db = await open();
  if (!db) {
    const rec = lsGetAll(STORE_IMGS).find(r => r.id === id);
    if (!rec) return null;
    const res = await fetch(rec.dataUrl);
    return { id, blob: await res.blob(), size: rec.size, type: rec.type };
  }
  return wrap(tx(db, STORE_IMGS).get(id));
}

export async function allImages() {
  const db = await open();
  if (!db) return lsGetAll(STORE_IMGS);
  return wrap(tx(db, STORE_IMGS).getAll());
}

export async function delImage(id) {
  const db = await open();
  if (!db) { lsSetAll(STORE_IMGS, lsGetAll(STORE_IMGS).filter(r => r.id !== id)); return; }
  await wrap(tx(db, STORE_IMGS, 'readwrite').delete(id));
}

/* ---------- meta ---------- */

export async function getMeta(key, dflt = null) {
  const db = await open();
  if (!db) {
    try { const v = localStorage.getItem(LS_KEY + 'meta.' + key); return v === null ? dflt : JSON.parse(v); }
    catch { return dflt; }
  }
  const rec = await wrap(tx(db, STORE_META).get(key));
  return rec ? rec.value : dflt;
}

export async function setMeta(key, value) {
  const db = await open();
  if (!db) { try { localStorage.setItem(LS_KEY + 'meta.' + key, JSON.stringify(value)); } catch {} return; }
  await wrap(tx(db, STORE_META, 'readwrite').put({ key, value }));
}

export async function storageEstimate() {
  try {
    if (navigator.storage?.estimate) {
      const e = await navigator.storage.estimate();
      return { usage: e.usage || 0, quota: e.quota || 0 };
    }
  } catch {}
  return { usage: 0, quota: 0 };
}

export const usingFallback = () => fallback;

export async function wipeAll() {
  const db = await open();
  if (!db) {
    Object.keys(localStorage).filter(k => k.startsWith(LS_KEY)).forEach(k => localStorage.removeItem(k));
    return;
  }
  const t = db.transaction([STORE_DOCS, STORE_IMGS, STORE_META], 'readwrite');
  t.objectStore(STORE_DOCS).clear();
  t.objectStore(STORE_IMGS).clear();
  t.objectStore(STORE_META).clear();
  return new Promise(res => { t.oncomplete = res; });
}
