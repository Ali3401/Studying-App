/* Lucid — a very small view router with hash URLs so iPad back/forward work. */

import { $, $$ } from './util.js';

const views = new Map();
let currentName = null;
let currentParams = {};
let navigating = false;

export function register(name, view) { views.set(name, view); }
export const current = () => ({ name: currentName, params: currentParams, view: views.get(currentName) });

function hashFor(name, params) {
  const p = new URLSearchParams(params || {});
  const q = p.toString();
  return `#/${name}${q ? '?' + q : ''}`;
}

function parseHash() {
  const h = location.hash.replace(/^#\/?/, '');
  if (!h) return { name: 'library', params: {} };
  const [name, query] = h.split('?');
  return { name: name || 'library', params: Object.fromEntries(new URLSearchParams(query || '')) };
}

export async function go(name, params = {}, { replace = false, silent = false } = {}) {
  if (!views.has(name)) name = 'library';
  const target = hashFor(name, params);
  if (!silent && location.hash !== target) {
    navigating = true;
    if (replace) history.replaceState({}, '', target);
    else history.pushState({}, '', target);
    navigating = false;
  }
  await show(name, params);
}

export const back = () => (history.length > 1 ? history.back() : go('library'));

async function show(name, params) {
  if (currentName === name && JSON.stringify(currentParams) === JSON.stringify(params)) {
    views.get(name)?.refresh?.(params);
    return;
  }
  const prev = views.get(currentName);
  await prev?.unmount?.();
  $$('.view').forEach(v => { v.hidden = v.dataset.view !== name; });
  currentName = name; currentParams = params;
  document.documentElement.dataset.view = name;
  await views.get(name)?.mount?.(params);
}

export function start() {
  addEventListener('hashchange', () => {
    if (navigating) return;
    const { name, params } = parseHash();
    show(name, params);
  });
  const { name, params } = parseHash();
  return show(name, params);
}

export const paramsOf = () => currentParams;
