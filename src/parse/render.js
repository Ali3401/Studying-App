/* Lucid — AST → HTML.
   Every text-bearing element gets a sequential data-bid so highlights can be
   anchored to (blockId, startOffset, endOffset) and survive re-renders. */

import { inline, plain, CALLOUTS } from './lmd.js';

const esc = (s = '') => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

export function render(blocks, ctx = {}) {
  const state = { n: 0, ids: new Map(), outline: [], quiz: 0 };
  const html = blocks.map(b => block(b, ctx, state)).join('\n');
  return { html, outline: state.outline, blockCount: state.n };
}

const bid = (st) => ` data-bid="b${st.n++}"`;

function headingId(text, st) {
  const base = plain(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'section';
  const c = (st.ids.get(base) || 0) + 1;
  st.ids.set(base, c);
  return `h-${base}${c > 1 ? '-' + c : ''}`;
}

function block(b, ctx, st) {
  if (!b) return '';
  switch (b.t) {

    case 'h': {
      const id = headingId(b.text, st);
      st.outline.push({ id, level: b.level, text: plain(b.text) });
      const lvl = Math.min(4, Math.max(1, b.level));
      return `<h${lvl} id="${id}"${bid(st)}>${inline(b.text, ctx)}` +
             `<a class="h-anchor" href="#${id}" aria-label="Link to section">#</a></h${lvl}>`;
    }

    case 'p':
      return `<p${bid(st)}>${inline(b.text, ctx)}</p>`;

    case 'hr':
      return ctx.ornament ? '<hr class="ornament" />' : '<hr />';

    case 'code':
      return `<pre${b.lang ? ` data-lang="${esc(b.lang)}"` : ''}><code${bid(st)}>${esc(b.code)}</code></pre>`;

    case 'math':
      return `<div class="f-body"${bid(st)}>${esc(b.code)}</div>`;

    case 'img': {
      const url = ctx.img ? ctx.img(b.src) : b.src;
      const cap = b.cap || b.alt;
      return `<figure><img src="${esc(url)}" alt="${esc(b.alt)}" loading="lazy" data-zoom="1" />` +
             (cap ? `<figcaption${bid(st)}>${inline(cap, ctx)}</figcaption>` : '') + `</figure>`;
    }

    case 'quote':
      return `<blockquote>${b.blocks.map(x => block(x, ctx, st)).join('\n')}</blockquote>`;

    case 'list': {
      const tag = b.ordered ? 'ol' : 'ul';
      const items = b.items.map(it => {
        const cls = it.checked === null ? '' : ` class="task${it.checked ? ' done' : ''}"`;
        const tick = it.checked === null ? '' : `<span class="tick" aria-hidden="true"></span>`;
        const kids = it.children ? '\n' + it.children.map(x => block(x, ctx, st)).join('\n') : '';
        return `<li${cls}>${tick}<span${bid(st)}>${inline(it.text, ctx)}</span>${kids}</li>`;
      }).join('\n');
      return `<${tag}>${items}</${tag}>`;
    }

    case 'table': {
      const head = b.head.map((h, i) => `<th style="text-align:${b.align?.[i] || 'left'}"${bid(st)}>${inline(h, ctx)}</th>`).join('');
      const rows = b.rows.map(r =>
        `<tr>${r.map((c, i) => `<td style="text-align:${b.align?.[i] || 'left'}"${bid(st)}>${inline(c, ctx)}</td>`).join('')}</tr>`
      ).join('\n');
      return `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
    }

    case 'deflist':
      return `<dl class="deflist">` + b.items.map(it =>
        `<dt${bid(st)}>${inline(it.term, ctx)}</dt><dd${bid(st)}>${inline(it.def, ctx)}</dd>`
      ).join('') + `</dl>`;

    case 'steps': {
      const meta = CALLOUTS.steps;
      const head = `<div class="callout-head"><span class="i" data-icon="${meta.icon}"></span>${esc(b.title || meta.label)}</div>`;
      const items = b.items.map(s => `<div class="step"${bid(st)}>${inline(s, ctx)}</div>`).join('');
      return `<div class="callout" data-type="steps">${head}<div class="steps">${items}</div></div>`;
    }

    case 'compare':
      return `<div class="compare">` +
        `<div class="compare-col"><h5${bid(st)}>${inline(b.left.title, ctx)}</h5>${b.left.blocks.map(x => block(x, ctx, st)).join('')}</div>` +
        `<div class="compare-col"><h5${bid(st)}>${inline(b.right.title, ctx)}</h5>${b.right.blocks.map(x => block(x, ctx, st)).join('')}</div>` +
        `</div>`;

    case 'quiz': {
      const cards = b.items.map((it) => {
        const qid = `q${st.quiz++}`;
        return `<div class="quiz" data-quiz="${qid}">` +
          `<div class="quiz-q" role="button" tabindex="0"><span class="i" data-icon="help"></span>` +
          `<span${bid(st)}>${inline(it.q, ctx)}</span><span class="i arrow" data-icon="chevron"></span></div>` +
          `<div class="quiz-a"><p${bid(st)}>${inline(it.a, ctx)}</p></div></div>`;
      }).join('\n');
      const head = b.title ? `<div class="callout-head" style="margin-bottom:.6em"><span class="i" data-icon="help"></span>${esc(b.title)}</div>` : '';
      return head + cards;
    }

    case 'callout': {
      const meta = CALLOUTS[b.type] || CALLOUTS.note;
      const label = b.title || meta.label;
      const head = `<div class="callout-head"><span class="i" data-icon="${meta.icon}"></span>${esc(label)}</div>`;
      const term = b.term ? `<span class="d-term"${bid(st)}>${inline(b.term, ctx)}</span>` : '';
      const body = b.blocks.map(x => block(x, ctx, st)).join('\n');
      return `<div class="callout" data-type="${esc(b.type)}">${head}${term}${body}</div>`;
    }

    default:
      return '';
  }
}

/** First paragraph-ish text, for library card excerpts. */
export function excerpt(blocks, max = 220) {
  let out = '';
  const walk = (bs) => {
    for (const b of bs) {
      if (out.length >= max) return;
      if (b.t === 'p') out += ' ' + plain(b.text);
      else if (b.t === 'list') out += ' ' + b.items.slice(0, 3).map(i => plain(i.text)).join(' · ');
      else if (b.t === 'callout' || b.t === 'quote') walk(b.blocks);
      else if (b.t === 'steps') out += ' ' + b.items.slice(0, 2).map(plain).join(' · ');
    }
  };
  walk(blocks);
  out = out.trim().replace(/\s+/g, ' ');
  return out.length > max ? out.slice(0, max).replace(/\s\S*$/, '') + '…' : out;
}

/** Everything as searchable plain text. */
export function textOf(blocks) {
  const parts = [];
  const walk = (bs) => {
    for (const b of bs) {
      if (!b) continue;
      if (b.t === 'h' || b.t === 'p') parts.push(plain(b.text));
      else if (b.t === 'list') b.items.forEach(i => { parts.push(plain(i.text)); if (i.children) walk(i.children); });
      else if (b.t === 'table') { parts.push(b.head.map(plain).join(' ')); b.rows.forEach(r => parts.push(r.map(plain).join(' '))); }
      else if (b.t === 'deflist') b.items.forEach(i => parts.push(plain(i.term) + ' ' + plain(i.def)));
      else if (b.t === 'steps') b.items.forEach(s => parts.push(plain(s)));
      else if (b.t === 'quiz') b.items.forEach(i => parts.push(plain(i.q) + ' ' + plain(i.a)));
      else if (b.t === 'compare') { walk(b.left.blocks); walk(b.right.blocks); }
      else if (b.t === 'code' || b.t === 'math') parts.push(b.code);
      else if (b.blocks) walk(b.blocks);
    }
  };
  walk(blocks);
  return parts.filter(Boolean).join('\n');
}
