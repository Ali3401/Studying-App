/* ==========================================================================
   Lucid — highlighting.

   A highlight is anchored to (blockId, start, end) where blockId is the
   sequential data-bid the renderer stamps on every text-bearing element and
   start/end are character offsets into that element's visible text.
   The quoted text is stored too, so a highlight can relocate itself when the
   note is edited and the offsets drift.
   ========================================================================== */

import { uid } from './util.js';

const SKIP = 'h-anchor';

/** Ordered text nodes inside a block, with cumulative offsets. */
function textMap(block) {
  const nodes = [];
  let total = 0;
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      for (let p = n.parentElement; p && p !== block; p = p.parentElement) {
        if (p.classList.contains(SKIP)) return NodeFilter.FILTER_REJECT;
      }
      return n.nodeValue.length ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });
  let n;
  while ((n = walker.nextNode())) {
    nodes.push({ node: n, start: total, end: total + n.nodeValue.length });
    total += n.nodeValue.length;
  }
  return { nodes, length: total };
}

export function blockText(block) {
  const { nodes } = textMap(block);
  return nodes.map(n => n.node.nodeValue).join('');
}

function locate(map, offset) {
  for (const rec of map.nodes) {
    if (offset >= rec.start && offset <= rec.end) return { node: rec.node, offset: offset - rec.start };
  }
  const last = map.nodes[map.nodes.length - 1];
  return last ? { node: last.node, offset: last.node.nodeValue.length } : null;
}

export function rangeFor(block, start, end) {
  const map = textMap(block);
  if (!map.nodes.length) return null;
  const s = locate(map, Math.max(0, Math.min(start, map.length)));
  const e = locate(map, Math.max(0, Math.min(end, map.length)));
  if (!s || !e) return null;
  const r = document.createRange();
  r.setStart(s.node, s.offset);
  r.setEnd(e.node, e.offset);
  return r;
}

/** Nearest ancestor carrying a data-bid. */
const blockOf = (node, root) => {
  let n = node.nodeType === 3 ? node.parentElement : node;
  while (n && n !== root) {
    if (n.dataset && n.dataset.bid) return n;
    n = n.parentElement;
  }
  return null;
};

function offsetIn(block, node, offset) {
  const map = textMap(block);
  for (const rec of map.nodes) {
    if (rec.node === node) return rec.start + offset;
  }
  // node is an element — count text before it
  const r = document.createRange();
  r.selectNodeContents(block);
  try { r.setEnd(node, offset); } catch { return 0; }
  return r.toString().length;
}

/**
 * Turn the current selection into one anchor per covered block.
 * @returns {Array<{bid:string, start:number, end:number, text:string}>}
 */
export function anchorsFromSelection(root) {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return [];
  const range = sel.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return [];

  const startBlock = blockOf(range.startContainer, root);
  const endBlock = blockOf(range.endContainer, root);
  if (!startBlock && !endBlock) return [];

  const blocks = Array.from(root.querySelectorAll('[data-bid]'));
  const si = blocks.indexOf(startBlock ?? blocks.find(b => range.intersectsNode(b)));
  const ei = blocks.indexOf(endBlock ?? blocks.filter(b => range.intersectsNode(b)).pop());
  if (si < 0 && ei < 0) return [];

  const from = si < 0 ? 0 : si;
  const to = ei < 0 ? blocks.length - 1 : ei;
  const out = [];

  for (let i = from; i <= to && i < blocks.length; i++) {
    const b = blocks[i];
    if (!range.intersectsNode(b)) continue;
    const map = textMap(b);
    if (!map.length) continue;
    const start = (b === startBlock) ? offsetIn(b, range.startContainer, range.startOffset) : 0;
    const end = (b === endBlock) ? offsetIn(b, range.endContainer, range.endOffset) : map.length;
    const text = blockText(b).slice(start, end);
    if (!text.trim()) continue;
    out.push({ bid: b.dataset.bid, start: Math.min(start, end), end: Math.max(start, end), text });
  }
  return out;
}

export function makeHighlight({ bid, start, end, text, color = 1, note = '' }) {
  return { id: uid('hl'), bid, start, end, text, color, note, createdAt: Date.now() };
}

/** Wrap a DOM range in a span, splitting partially-selected inline elements. */
function wrap(range, attrs) {
  const span = document.createElement('span');
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') span.className = v;
    else if (k === 'style') span.setAttribute('style', v);
    else span.setAttribute(k, v);
  }
  try {
    if (range.startContainer === range.endContainer && range.startContainer.nodeType === 3) {
      range.surroundContents(span);
    } else {
      span.append(range.extractContents());
      range.insertNode(span);
    }
  } catch {
    try { span.append(range.extractContents()); range.insertNode(span); } catch { return null; }
  }
  return span;
}

/**
 * Paint every highlight of a document onto the rendered prose.
 * Returns the highlights that could not be placed (orphans).
 */
export function paint(root, highlights) {
  const byBid = new Map();
  for (const h of highlights) {
    if (!byBid.has(h.bid)) byBid.set(h.bid, []);
    byBid.get(h.bid).push(h);
  }
  const orphans = [];

  for (const [bid, list] of byBid) {
    let block = root.querySelector(`[data-bid="${CSS.escape(bid)}"]`);
    const resolved = [];

    for (const h of list) {
      let target = block;
      let start = h.start, end = h.end;
      const ok = target && blockText(target).slice(start, end) === h.text;
      if (!ok) {
        const found = relocate(root, h, target);
        if (!found) { orphans.push(h); continue; }
        target = found.block; start = found.start; end = found.end;
        h.bid = target.dataset.bid; h.start = start; h.end = end;
      }
      resolved.push({ h, target, start, end });
    }

    // paint from the end so earlier offsets stay valid
    resolved.sort((a, b) => b.start - a.start);
    for (const { h, target, start, end } of resolved) {
      const r = rangeFor(target, start, end);
      if (!r) { orphans.push(h); continue; }
      const span = wrap(r, {
        class: 'hl' + (h.note ? ' has-note' : ''),
        'data-hl': h.id,
        style: `--h:${hueOf(h.color)}`,
        title: h.note ? h.note : '',
      });
      if (!span) orphans.push(h);
    }
  }
  return orphans;
}

const HUES = { 1: 48, 2: 145, 3: 200, 4: 330, 5: 268 };
export const hueOf = (c) => HUES[c] || HUES[1];

/** Find a highlight's quoted text somewhere in the document. */
function relocate(root, h, preferred) {
  const needle = (h.text || '').trim();
  if (needle.length < 3) return null;
  const blocks = Array.from(root.querySelectorAll('[data-bid]'));
  if (preferred) {
    const idx = blocks.indexOf(preferred);
    if (idx > 0) blocks.unshift(...blocks.splice(idx, 1));
  }
  for (const b of blocks) {
    const t = blockText(b);
    const i = t.indexOf(needle);
    if (i >= 0) return { block: b, start: i, end: i + needle.length };
  }
  // loosen: collapse whitespace
  const loose = needle.replace(/\s+/g, ' ');
  for (const b of blocks) {
    const t = blockText(b).replace(/\s+/g, ' ');
    const i = t.indexOf(loose);
    if (i >= 0) return { block: b, start: i, end: i + loose.length };
  }
  return null;
}

/** Remove a highlight's spans from the DOM, keeping the text. */
export function unpaint(root, id) {
  root.querySelectorAll(`[data-hl="${CSS.escape(id)}"]`).forEach(span => {
    const parent = span.parentNode;
    while (span.firstChild) parent.insertBefore(span.firstChild, span);
    span.remove();
    parent.normalize();
  });
}

/** Highlights whose range overlaps the given anchor. */
export function overlapping(highlights, anchor) {
  return highlights.filter(h => h.bid === anchor.bid && h.start < anchor.end && anchor.start < h.end);
}

export function mergeAnchor(anchor, overlaps) {
  let { start, end } = anchor;
  for (const o of overlaps) { start = Math.min(start, o.start); end = Math.max(end, o.end); }
  return { ...anchor, start, end };
}
