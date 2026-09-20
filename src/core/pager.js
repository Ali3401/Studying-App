/* ==========================================================================
   Lucid — pagination.

   Turns the continuous page into discrete pages, or into a two-page spread
   like an open book, using CSS multi-column layout: the article becomes a
   multicol box exactly as tall as the window, text flows into column after
   column off to the right, and turning a page is a horizontal translate.

   Everything else keeps working, because nothing about the DOM changes —
   highlights, find, and the outline all still point at the same elements.
   They just have to ask which page an element landed on.
   ========================================================================== */

import { clamp } from './util.js';

export function createPager({ viewport, sheet, onChange }) {
  let mode = 'scroll';
  let index = 0;
  let count = 1;
  let step = 0;          // distance between one page (or spread) and the next
  let cols = 1;          // leaves visible at once: 1 for a page, 2 for a spread
  let padL = 0;          // the sheet's left padding, so offsets stay in the flow

  const isPaged = () => mode !== 'scroll';

  function measure() {
    if (!isPaged()) { count = 1; index = 0; step = 0; cols = 1; return; }

    const cs = getComputedStyle(sheet);
    padL = parseFloat(cs.paddingLeft) || 0;
    const padR = parseFloat(cs.paddingRight) || 0;
    const gap = parseFloat(cs.columnGap) || 0;
    cols = Math.max(1, parseInt(cs.columnCount, 10) || 1);

    // Columns live in the content box, so one page advances by the content
    // width plus a gap — not by the element's width, which includes padding.
    const contentWidth = Math.max(1, sheet.clientWidth - padL - padR);
    step = contentWidth + gap;

    // Measure with the page at rest, then put it back where it was.
    const wasX = sheet.style.getPropertyValue('--page-x');
    sheet.classList.add('no-turn');
    sheet.style.setProperty('--page-x', '0px');

    // scrollWidth is unreliable for an overflowing multicol box, so ask the
    // layout directly: a probe at the end of the flow lands in the last column
    const probe = document.createElement('i');
    probe.className = 'page-probe';
    sheet.append(probe);
    const origin = sheet.getBoundingClientRect().left + padL;
    const reach = probe.getBoundingClientRect().left - origin;
    probe.remove();

    sheet.style.setProperty('--page-x', wasX || '0px');

    count = Math.max(1, Math.floor(reach / step + 0.02) + 1);
    index = clamp(index, 0, count - 1);
    apply();
    requestAnimationFrame(() => sheet.classList.remove('no-turn'));
  }

  function apply(direction = 0) {
    sheet.style.setProperty('--page-x', isPaged() ? `${-index * step}px` : '0px');
    onChange?.({ index, count, mode, direction });
  }

  function go(i, { animate = true } = {}) {
    if (!isPaged()) return false;
    const next = clamp(Math.round(i), 0, count - 1);
    if (next === index) { apply(); return false; }
    if (!animate) sheet.classList.add('no-turn');
    const direction = next > index ? 1 : -1;
    index = next;
    apply(animate ? direction : 0);
    if (!animate) requestAnimationFrame(() => sheet.classList.remove('no-turn'));
    return true;
  }

  const next = () => go(index + 1);
  const prev = () => go(index - 1);

  /** Which page an element has landed on, now that the text has reflowed.

      Measured against the sheet rather than the window: mid-turn the sheet
      is part-way through its translate, and so is everything inside it, so
      the difference between the two is the only stable number here. */
  function pageOf(el) {
    if (!isPaged() || !el || !step) return 0;
    const left = el.getBoundingClientRect().left - sheet.getBoundingClientRect().left - padL;
    return clamp(Math.floor(left / step + 0.001), 0, count - 1);
  }

  /** Bring an element into view whichever mode we are in. */
  function reveal(el, { behavior = 'smooth' } = {}) {
    if (!el) return;
    if (!isPaged()) { el.scrollIntoView({ block: 'center', behavior }); return; }
    go(pageOf(el));
  }

  function setMode(next) {
    if (next === mode) return;
    mode = next;
    index = 0;
    if (!isPaged()) sheet.style.setProperty('--page-x', '0px');
    measure();
  }

  /** Remember roughly where we were, so a resize does not lose the place. */
  const progress = () => (count > 1 ? index / (count - 1) : 0);
  const restore = (p) => go(Math.round(p * (count - 1)), { animate: false });

  return {
    measure, go, next, prev, pageOf, reveal, setMode, progress, restore, apply,
    get index() { return index; },
    get count() { return count; },
    get mode() { return mode; },
    get cols() { return cols; },
    get paged() { return isPaged(); },
  };
}
