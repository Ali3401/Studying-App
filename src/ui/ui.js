/* Lucid — shared UI primitives: toasts, side sheet, context menu, lightbox. */

import { $, el, add } from '../core/util.js';

/* ---------------- toasts ---------------- */
const stack = () => $('#toasts');

export function toast(msg, { icon = 'check', kind = 'ok', ms = 2600, action } = {}) {
  const node = el('div', { class: `toast ${kind}` },
    el('span', { class: 'i', dataset: { icon } }),
    el('span', { text: msg }),
    action ? el('button', { text: action.label, onclick: () => { action.fn(); close(); } }) : null,
  );
  stack().append(node);
  let timer = setTimeout(close, ms);
  node.addEventListener('mouseenter', () => clearTimeout(timer));
  node.addEventListener('mouseleave', () => { timer = setTimeout(close, 1200); });
  function close() {
    clearTimeout(timer);
    node.classList.add('is-out');
    setTimeout(() => node.remove(), 260);
  }
  return close;
}

/* ---------------- focus management ---------------- */

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const visible = (n) => n.offsetWidth || n.offsetHeight || n.getClientRects().length;

/**
 * Keep Tab inside a dialog while it is open, and hand focus back to whatever
 * opened it afterwards. Returns a function that undoes both.
 */
export function trapFocus(container, { restoreTo } = {}) {
  const previous = restoreTo || (document.activeElement instanceof HTMLElement ? document.activeElement : null);

  const onKey = (e) => {
    if (e.key !== 'Tab') return;
    const items = Array.from(container.querySelectorAll(FOCUSABLE)).filter(visible);
    if (!items.length) { e.preventDefault(); return; }
    const first = items[0], last = items[items.length - 1];
    const active = document.activeElement;
    if (!container.contains(active)) { e.preventDefault(); first.focus(); return; }
    if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
  };

  container.addEventListener('keydown', onKey);
  return () => {
    container.removeEventListener('keydown', onKey);
    if (!previous || !document.body.contains(previous)) return;
    // Hiding an element does not always blur what is inside it, so focus may
    // still be in the dialog — or nowhere. Either way it should come back.
    // If it has moved somewhere real instead, leave it alone.
    const active = document.activeElement;
    const stranded = !active || active === document.body || container.contains(active);
    if (!stranded) return;
    try { previous.focus({ preventScroll: true }); } catch { previous.focus(); }
  };
}

/* ---------------- scrim ---------------- */
let scrimUsers = 0;
function showScrim(onClick) {
  const s = $('#scrim');
  scrimUsers++;
  s.hidden = false;
  s.onclick = onClick;
}
function hideScrim() {
  scrimUsers = Math.max(0, scrimUsers - 1);
  if (!scrimUsers) { const s = $('#scrim'); s.hidden = true; s.onclick = null; }
}

/* ---------------- side sheet ---------------- */
let sheetClose = null;
let releaseSheetFocus = null;

export function sheet({ title, body, foot, wide = false, onClose } = {}) {
  closeSheet();
  const node = $('#sheet');
  node.classList.toggle('is-wide', !!wide);
  $('#sheet-title').textContent = title || '';
  const b = $('#sheet-body'); b.innerHTML = '';
  const f = $('#sheet-foot'); f.innerHTML = '';
  if (body) add(b, Array.isArray(body) ? body : [body]);
  if (foot) add(f, Array.isArray(foot) ? foot : [foot]);
  node.hidden = false;
  showScrim(closeSheet);
  sheetClose = () => { onClose?.(); };
  releaseSheetFocus = trapFocus(node);
  const first = b.querySelector('input, textarea, button') || $('#sheet-title');
  if (first && !('ontouchstart' in window)) setTimeout(() => first.focus?.(), 60);
  return { node, body: b, foot: f, close: closeSheet };
}

export function closeSheet() {
  const node = $('#sheet');
  if (node.hidden) return false;
  node.hidden = true;
  hideScrim();
  releaseSheetFocus?.(); releaseSheetFocus = null;
  sheetClose?.(); sheetClose = null;
  return true;
}

export const sheetOpen = () => !$('#sheet').hidden;

/* ---------------- context menu ---------------- */
let menuCloser = null;
let releaseMenuFocus = null;

export function menu(items, { x, y, anchor, align = 'end' } = {}) {
  closeMenu();
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const node = $('#menu');
  node.innerHTML = '';
  for (const it of items) {
    if (it === '-' || it?.sep) { node.append(el('div', { class: 'menu-sep' })); continue; }
    if (it.header) { node.append(el('div', { class: 'pal-group', text: it.header })); continue; }
    node.append(el('button', {
      class: 'menu-item' + (it.danger ? ' danger' : ''),
      role: 'menuitem',
      onclick: (e) => { e.stopPropagation(); closeMenu(); it.fn?.(); },
    },
      it.icon ? el('span', { class: 'i', dataset: { icon: it.icon } }) : null,
      el('span', { text: it.label }),
      it.sub ? el('span', { class: 'sub', text: it.sub }) : null,
    ));
  }
  node.hidden = false;
  node.style.visibility = 'hidden';

  requestAnimationFrame(() => {
    const r = node.getBoundingClientRect();
    let left = x, top = y;
    if (anchor) {
      const a = anchor.getBoundingClientRect();
      left = align === 'end' ? a.right - r.width : a.left;
      top = a.bottom + 6;
    }
    left = Math.max(8, Math.min(left, innerWidth - r.width - 8));
    top = Math.max(8, Math.min(top, innerHeight - r.height - 8));
    node.style.left = left + 'px';
    node.style.top = top + 'px';
    node.style.visibility = '';
  });

  const off = (e) => { if (!node.contains(e.target)) closeMenu(); };
  setTimeout(() => {
    document.addEventListener('pointerdown', off, true);
    window.addEventListener('scroll', closeMenu, { capture: true, once: true });
    window.addEventListener('resize', closeMenu, { once: true });
  }, 0);
  menuCloser = () => document.removeEventListener('pointerdown', off, true);
  releaseMenuFocus = trapFocus(node, { restoreTo: anchor || opener });
  node.addEventListener('keydown', (e) => {
    const items2 = Array.from(node.querySelectorAll('.menu-item'));
    const i = items2.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); items2[(i + 1) % items2.length]?.focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); items2[(i - 1 + items2.length) % items2.length]?.focus(); }
  });
  setTimeout(() => node.querySelector('.menu-item')?.focus({ preventScroll: true }), 30);
  return closeMenu;
}

export function closeMenu() {
  const node = $('#menu');
  if (node.hidden) return false;
  node.hidden = true;
  menuCloser?.(); menuCloser = null;
  releaseMenuFocus?.(); releaseMenuFocus = null;
  return true;
}

/* ---------------- lightbox ---------------- */
let releaseLightboxFocus = null;

export function lightbox(src, caption = '') {
  const box = $('#lightbox');
  $('#lightbox-img').src = src;
  $('#lightbox-cap').textContent = caption;
  $('#lightbox-img').alt = caption || 'Picture from this note';
  box.hidden = false;
  releaseLightboxFocus = trapFocus(box);
  setTimeout(() => box.querySelector('.lightbox-close')?.focus({ preventScroll: true }), 30);
}
export function closeLightbox() {
  const box = $('#lightbox');
  if (box.hidden) return false;
  box.hidden = true;
  $('#lightbox-img').src = '';
  releaseLightboxFocus?.(); releaseLightboxFocus = null;
  return true;
}

/* ---------------- confirm / prompt ---------------- */
export function confirmDialog({ title, message, confirmLabel = 'Confirm', danger = false, onConfirm }) {
  const { close } = sheet({
    title,
    body: el('p', { class: 'hint', style: { fontSize: 'var(--fs-ui)', lineHeight: '1.6' }, text: message }),
    foot: [
      el('button', { class: 'btn btn-outline', text: 'Cancel', onclick: () => close() }),
      el('button', {
        class: 'btn ' + (danger ? 'btn-danger btn-outline' : 'btn-primary'),
        text: confirmLabel,
        onclick: () => { close(); onConfirm?.(); },
      }),
    ],
  });
}

export function promptDialog({ title, label, value = '', placeholder = '', multiline = false, confirmLabel = 'Save', onSave }) {
  const input = multiline
    ? el('textarea', { placeholder, style: { minHeight: '140px' } })
    : el('input', { class: '', placeholder, value, style: { width: '100%', minHeight: 'var(--tap)', padding: '0 12px', background: 'var(--surface)', border: 'var(--border-w) solid var(--line)', borderRadius: 'var(--radius-sm)', outline: 'none' } });
  if (multiline) input.value = value;
  const { close } = sheet({
    title,
    body: el('div', { class: 'group' }, label ? el('h4', { text: label }) : null, input),
    foot: [
      el('button', { class: 'btn btn-outline', text: 'Cancel', onclick: () => close() }),
      el('button', { class: 'btn btn-primary', text: confirmLabel, onclick: () => { close(); onSave?.(input.value); } }),
    ],
  });
  setTimeout(() => input.focus(), 60);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (!multiline || e.metaKey || e.ctrlKey)) { e.preventDefault(); close(); onSave?.(input.value); }
  });
}

/* ---------------- helpers ---------------- */
export const row = (label, control) => el('div', { class: 'row' }, el('span', { text: label }), control);

export function slider({ min, max, step, value, onInput, format = (v) => v }) {
  const val = el('span', { class: 'val', text: format(value) });
  const input = el('input', {
    type: 'range', min, max, step, value,
    oninput: (e) => { const v = +e.target.value; val.textContent = format(v); onInput(v); },
  });
  const wrap = el('div', { class: 'stack', style: { flex: '1' } }, input);
  return { input, val, wrap };
}

export function sliderRow(label, opts) {
  const s = slider(opts);
  const r = el('div', { class: 'stack' },
    el('div', { class: 'row' }, el('span', { text: label }), s.val),
    s.input,
  );
  return { node: r, set: (v) => { s.input.value = v; s.val.textContent = opts.format ? opts.format(v) : v; } };
}

export function toggleRow(label, checked, onChange, hint) {
  const input = el('input', { type: 'checkbox', checked, onchange: (e) => onChange(e.target.checked) });
  const sw = el('label', { class: 'switch' }, input);
  return el('div', { class: 'stack' },
    el('div', { class: 'row' }, el('span', { text: label }), sw),
    hint ? el('p', { class: 'hint', text: hint }) : null,
  );
}

export function optionRow(label, options, value, onPick) {
  const btns = options.map(o => el('button', {
    class: 'opt-btn' + (o.id === value ? ' is-on' : ''),
    text: o.name,
    onclick: (e) => {
      e.currentTarget.parentElement.querySelectorAll('.opt-btn').forEach(b => b.classList.remove('is-on'));
      e.currentTarget.classList.add('is-on');
      onPick(o.id);
    },
  }));
  return el('div', { class: 'stack' },
    el('div', { class: 'row' }, el('span', { text: label })),
    el('div', { class: 'opt-row' }, ...btns),
  );
}
