/* Lucid — small helpers */

export const $  = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'style' && typeof v === 'object') {
      // custom properties need setProperty — assigning them is silently ignored
      for (const [prop, val] of Object.entries(v)) {
        if (val === null || val === undefined) continue;
        if (prop.startsWith('--')) node.style.setProperty(prop, String(val));
        else node.style[prop] = val;
      }
    }
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

/**
 * Append children, skipping the empty ones. Element.append() turns null into
 * the literal text "null", which el() does not — so anything built with a
 * conditional child has to come through here.
 */
export function add(parent, ...children) {
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false || c === '') continue;
    parent.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return parent;
}

export const uid = (p = 'x') =>
  p + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

export function debounce(fn, ms = 250) {
  let t;
  const wrapped = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  wrapped.cancel = () => clearTimeout(t);
  wrapped.flush = (...a) => { clearTimeout(t); fn(...a); };
  return wrapped;
}

export function throttle(fn, ms = 100) {
  let last = 0, timer = null;
  return (...a) => {
    const now = Date.now();
    if (now - last >= ms) { last = now; fn(...a); }
    else { clearTimeout(timer); timer = setTimeout(() => { last = Date.now(); fn(...a); }, ms - (now - last)); }
  };
}

export const escapeHtml = (s = '') =>
  String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

export const escapeAttr = escapeHtml;

/** Human-friendly relative/absolute date. */
export function fmtDate(ts) {
  if (!ts) return '—';
  const d = new Date(ts), now = new Date();
  const diff = (now - d) / 1000;
  if (diff < 45) return 'just now';
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  if (diff < 86400 && d.getDate() === now.getDate()) return `${Math.round(diff / 3600)}h ago`;
  const y = new Date(now); y.setDate(y.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'yesterday';
  if (diff < 86400 * 6) return d.toLocaleDateString(undefined, { weekday: 'long' });
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) });
}

export const fmtBytes = (b) => {
  if (!b) return '0 KB';
  const u = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(b) / Math.log(1024)));
  return `${(b / 1024 ** i).toFixed(i < 2 ? 0 : 1)} ${u[i]}`;
};

export const countWords = (s = '') => (s.trim().match(/[\p{L}\p{N}'’-]+/gu) || []).length;
export const readTime = (words) => Math.max(1, Math.round(words / 220));

/** case/diacritic-insensitive needle test */
export const norm = (s = '') =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Tiny fuzzy subsequence match; returns score or -1. */
export function fuzzy(needle, hay) {
  const n = norm(needle), h = norm(hay);
  if (!n) return 0;
  const direct = h.indexOf(n);
  if (direct >= 0) return 1000 - direct - (h.length - n.length) * 0.05;
  let hi = 0, score = 0, streak = 0;
  for (const ch of n) {
    const idx = h.indexOf(ch, hi);
    if (idx < 0) return -1;
    streak = idx === hi ? streak + 1 : 0;
    score += 10 + streak * 4 - Math.min(9, idx - hi);
    hi = idx + 1;
  }
  return score;
}

export function highlightMatch(text, q) {
  if (!q) return escapeHtml(text);
  const i = norm(text).indexOf(norm(q));
  if (i < 0) return escapeHtml(text);
  return escapeHtml(text.slice(0, i)) + '<mark>' + escapeHtml(text.slice(i, i + q.length)) + '</mark>' + escapeHtml(text.slice(i + q.length));
}

export function slug(s = '') {
  return norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'section';
}

export async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* fall through */ }
  try {
    const ta = el('textarea', { style: { position: 'fixed', top: '-1000px', opacity: '0' } });
    ta.value = text; document.body.append(ta); ta.select();
    const ok = document.execCommand('copy'); ta.remove(); return ok;
  } catch { return false; }
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export const downloadText = (text, filename, type = 'text/plain') =>
  downloadBlob(new Blob([text], { type: type + ';charset=utf-8' }), filename);

export const readFileText = (file) => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result));
  r.onerror = () => rej(r.error);
  r.readAsText(file);
});

export const readFileBuffer = (file) => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(r.result);
  r.onerror = () => rej(r.error);
  r.readAsArrayBuffer(file);
});

export const blobToDataURL = (blob) => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result));
  r.onerror = () => rej(r.error);
  r.readAsDataURL(blob);
});

export async function dataURLToBlob(url) {
  const r = await fetch(url);
  return r.blob();
}

export const isApple = () =>
  /Mac|iPhone|iPad|iPod/.test(navigator.platform || '') ||
  (navigator.userAgent.includes('Mac') && 'ontouchend' in document);

export const mod = () => (isApple() ? '⌘' : 'Ctrl');

export const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/** Wait for next paint. */
export const raf = () => new Promise(r => requestAnimationFrame(() => r()));

export function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const todayStr = () => new Date().toISOString().slice(0, 10);

/** Sort titles the way a person would: "Lecture 2" before "Lecture 10". */
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
export const naturalCompare = (a, b) => collator.compare(String(a || ''), String(b || ''));

export function pluralize(n, one, many) {
  return `${n} ${n === 1 ? one : (many || one + 's')}`;
}
