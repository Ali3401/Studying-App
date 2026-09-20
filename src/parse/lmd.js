/* ==========================================================================
   Lucid Markdown (LMD) — a small, forgiving superset of Markdown built for
   lecture summaries. Parses to an AST; render.js turns the AST into HTML.

   Block syntax on top of standard Markdown:

     ::: key Title            a coloured callout (key, note, tip, warn, exam,
     body                     example, definition, formula, summary, mnemonic)
     :::

     ::: steps Title          numbered step list (one step per line/bullet)
     ::: compare A vs B       two columns split by a line containing only |||
     ::: quiz                 Q:/A: pairs → collapsible cards + flashcards
     Q: question
     A: answer
     :::

     term :: definition       definition list row
     $$ ... $$                display formula
   ========================================================================== */

export const CALLOUTS = {
  key:        { icon: 'star',   label: 'Key idea' },
  note:       { icon: 'note',   label: 'Note' },
  tip:        { icon: 'bolt',   label: 'Tip' },
  warn:       { icon: 'flame',  label: 'Careful' },
  exam:       { icon: 'target', label: 'Exam focus' },
  example:    { icon: 'quote',  label: 'Example' },
  definition: { icon: 'book',   label: 'Definition' },
  formula:    { icon: 'hash',   label: 'Formula' },
  summary:    { icon: 'list',   label: 'Summary' },
  mnemonic:   { icon: 'wand',   label: 'Mnemonic' },
  steps:      { icon: 'list',   label: 'Steps' },
  compare:    { icon: 'table',  label: 'Compare' },
  quiz:       { icon: 'help',   label: 'Check yourself' },
};

const ALIASES = {
  important: 'key', keypoint: 'key', main: 'key', takeaway: 'key', highlight: 'key',
  info: 'note', remember: 'note', memo: 'note',
  hint: 'tip', trick: 'tip', pro: 'tip',
  warning: 'warn', caution: 'warn', danger: 'warn', pitfall: 'warn', mistake: 'warn',
  test: 'exam', 'exam-tip': 'exam', mcq: 'exam',
  eg: 'example', case: 'example', clinical: 'example',
  def: 'definition', term: 'definition', vocab: 'definition',
  equation: 'formula', math: 'formula', eq: 'formula',
  recap: 'summary', tldr: 'summary', overview: 'summary',
  acronym: 'mnemonic', mem: 'mnemonic',
  process: 'steps', procedure: 'steps', how: 'steps', sequence: 'steps',
  vs: 'compare', versus: 'compare', contrast: 'compare',
  qa: 'quiz', question: 'quiz', questions: 'quiz', cards: 'quiz', flashcards: 'quiz',
};

export const resolveType = (t) => {
  const k = String(t || '').toLowerCase().trim();
  return CALLOUTS[k] ? k : (ALIASES[k] || null);
};

/* ---------------- frontmatter ---------------- */

export function splitFrontmatter(src = '') {
  const text = String(src).replace(/\r\n?/g, '\n');
  const m = /^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(text);
  if (!m) return { meta: {}, body: text };
  const meta = {};
  for (const line of m[1].split('\n')) {
    const mm = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line.trim());
    if (!mm) continue;
    let v = mm[2].trim().replace(/^["']|["']$/g, '');
    const key = mm[1].toLowerCase();
    if (key === 'tags') meta.tags = v.split(/[,;]/).map(s => s.trim()).filter(Boolean);
    else meta[key] = v;
  }
  return { meta, body: text.slice(m[0].length) };
}

export function buildFrontmatter(meta = {}) {
  const keys = ['title', 'subject', 'tags', 'emoji', 'accent'];
  const lines = [];
  for (const k of keys) {
    let v = meta[k];
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) continue;
    if (Array.isArray(v)) v = v.join(', ');
    lines.push(`${k}: ${v}`);
  }
  return lines.length ? `---\n${lines.join('\n')}\n---\n\n` : '';
}

/* ---------------- block parser ---------------- */

const RE = {
  heading:  /^(#{1,6})\s+(.*)$/,
  setext1:  /^={3,}\s*$/,
  setext2:  /^-{3,}\s*$/,
  hr:       /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/,
  fence:    /^\s{0,3}(`{3,}|~{3,})\s*([\w+-]*)\s*$/,
  container:/^\s{0,3}:{3,}\s*([\w-]*)\s*(.*)$/,
  bullet:   /^(\s*)([-*+•‣◦·])\s+(.*)$/,
  ordered:  /^(\s*)(\d{1,3})[.)]\s+(.*)$/,
  quote:    /^\s{0,3}>\s?(.*)$/,
  table:    /^\s*\|(.+)\|\s*$/,
  tsep:     /^\s*\|?[\s:|-]+\|[\s:|-]*$/,
  task:     /^\[([ xX])\]\s+(.*)$/,
  deflist:  /^(.{1,80}?)\s+::\s+(.+)$/,
  qline:    /^\s*(?:\*\*)?Q(?:uestion)?(?:\*\*)?\s*[:.)]\s*(.*)$/i,
  aline:    /^\s*(?:\*\*)?A(?:nswer)?(?:\*\*)?\s*[:.)]\s*(.*)$/i,
  mathfence:/^\s*\$\$\s*$/,
  image:    /^\s*!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)\s*$/,
};

function stripListMarkers(lines) {
  return lines.map(l => l.replace(/^\s*[-*+•‣]\s+/, '').trim()).filter(Boolean);
}

/**
 * @param {string} src
 * @returns {{meta:Object, blocks:Array}}
 */
export function parse(src = '') {
  const { meta, body } = splitFrontmatter(src);
  return { meta, blocks: parseBlocks(body.split('\n')) };
}

export function parseBlocks(lines) {
  const out = [];
  let i = 0;

  const peek = (n = 0) => lines[i + n];

  while (i < lines.length) {
    let line = lines[i];

    /* blank */
    if (!line || !line.trim()) { i++; continue; }

    /* fenced code */
    let m = RE.fence.exec(line);
    if (m) {
      const fence = m[1][0], len = m[1].length, lang = m[2] || '';
      const buf = [];
      i++;
      while (i < lines.length) {
        const cl = new RegExp(`^\\s{0,3}${fence}{${len},}\\s*$`).exec(lines[i]);
        if (cl) { i++; break; }
        buf.push(lines[i]); i++;
      }
      out.push({ t: 'code', lang, code: buf.join('\n') });
      continue;
    }

    /* display math */
    if (RE.mathfence.test(line)) {
      const buf = []; i++;
      while (i < lines.length && !RE.mathfence.test(lines[i])) { buf.push(lines[i]); i++; }
      i++;
      out.push({ t: 'callout', type: 'formula', title: '', blocks: [{ t: 'math', code: buf.join('\n').trim() }] });
      continue;
    }

    /* ::: containers */
    m = RE.container.exec(line);
    if (m) {
      const rawType = m[1] || 'note';
      const title = (m[2] || '').trim();
      const buf = [];
      let depth = 1;
      i++;
      while (i < lines.length) {
        const cm = RE.container.exec(lines[i]);
        if (cm) {
          if (!cm[1] && !cm[2]) { depth--; if (!depth) { i++; break; } }
          else depth++;
        }
        buf.push(lines[i]); i++;
      }
      out.push(buildContainer(rawType, title, buf));
      continue;
    }

    /* heading */
    m = RE.heading.exec(line);
    if (m) {
      out.push({ t: 'h', level: Math.min(4, m[1].length), text: m[2].replace(/\s+#+\s*$/, '').trim() });
      i++; continue;
    }

    /* setext heading */
    if (peek(1) !== undefined && line.trim() && !RE.bullet.test(line) && !RE.ordered.test(line)) {
      if (RE.setext1.test(peek(1) || '')) { out.push({ t: 'h', level: 1, text: line.trim() }); i += 2; continue; }
      if (RE.setext2.test(peek(1) || '') && !RE.hr.test(line)) { out.push({ t: 'h', level: 2, text: line.trim() }); i += 2; continue; }
    }

    /* horizontal rule */
    if (RE.hr.test(line)) { out.push({ t: 'hr' }); i++; continue; }

    /* standalone image */
    m = RE.image.exec(line);
    if (m) { out.push({ t: 'img', src: m[2], alt: m[1], cap: m[3] || '' }); i++; continue; }

    /* table */
    if (RE.table.test(line) && RE.tsep.test(peek(1) || '')) {
      const head = splitRow(line);
      const align = splitRow(peek(1)).map(c => c.includes(':') && c.endsWith(':') ? (c.startsWith(':') ? 'center' : 'right') : 'left');
      i += 2;
      const rows = [];
      while (i < lines.length && RE.table.test(lines[i])) { rows.push(splitRow(lines[i])); i++; }
      out.push({ t: 'table', head, align, rows });
      continue;
    }

    /* blockquote */
    if (RE.quote.test(line)) {
      const buf = [];
      while (i < lines.length && (RE.quote.test(lines[i]) || (lines[i].trim() && buf.length && !isBlockStart(lines[i])))) {
        const qm = RE.quote.exec(lines[i]);
        buf.push(qm ? qm[1] : lines[i].trim());
        i++;
      }
      out.push({ t: 'quote', blocks: parseBlocks(buf) });
      continue;
    }

    /* Q:/A: pair outside a quiz container */
    m = RE.qline.exec(line);
    if (m && RE.aline.test(peek(1) || peek(2) || '')) {
      const q = [m[1]]; i++;
      while (i < lines.length && lines[i].trim() && !RE.aline.test(lines[i])) { q.push(lines[i].trim()); i++; }
      while (i < lines.length && !RE.aline.test(lines[i])) i++;
      const am = RE.aline.exec(lines[i] || '');
      const a = am ? [am[1]] : [];
      i++;
      while (i < lines.length && lines[i].trim() && !RE.qline.test(lines[i]) && !isBlockStart(lines[i])) { a.push(lines[i]); i++; }
      out.push({ t: 'quiz', items: [{ q: q.join(' ').trim(), a: a.join('\n').trim() }] });
      continue;
    }

    /* definition list */
    if (RE.deflist.test(line) && !RE.bullet.test(line)) {
      const items = [];
      while (i < lines.length) {
        const dm = RE.deflist.exec(lines[i]);
        if (!dm) break;
        items.push({ term: dm[1].trim(), def: dm[2].trim() });
        i++;
      }
      if (items.length) { out.push({ t: 'deflist', items }); continue; }
    }

    /* lists */
    if (RE.bullet.test(line) || RE.ordered.test(line)) {
      const { list, next } = parseList(lines, i);
      out.push(list); i = next; continue;
    }

    /* paragraph */
    const buf = [];
    while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i])) { buf.push(lines[i].trim()); i++; }
    if (buf.length) out.push({ t: 'p', text: buf.join('\n') });
    else i++;
  }
  return out;
}

function isBlockStart(line) {
  return RE.heading.test(line) || RE.hr.test(line) || RE.fence.test(line) ||
         RE.container.test(line) || RE.bullet.test(line) || RE.ordered.test(line) ||
         RE.quote.test(line) || RE.table.test(line) || RE.mathfence.test(line) ||
         RE.image.test(line) || RE.qline.test(line);
}

const splitRow = (line) =>
  line.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map(c => c.trim().replace(/\\\|/g, '|'));

function indentOf(s) {
  const m = /^(\s*)/.exec(s);
  return m[1].replace(/\t/g, '  ').length;
}

function parseList(lines, start) {
  const first = lines[start];
  const ordered = RE.ordered.test(first) && !RE.bullet.test(first);
  const sameKind = (line) => (ordered ? RE.ordered.test(line) && !RE.bullet.test(line) : RE.bullet.test(line));
  const baseIndent = indentOf(first);
  const items = [];
  let i = start;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      // a blank line ends the list unless an item of the same kind follows
      const nxt = lines[i + 1];
      if (!nxt || !nxt.trim()) break;
      const continues = (sameKind(nxt) && indentOf(nxt) === baseIndent) || indentOf(nxt) >= baseIndent + 2;
      if (!continues) break;
      i++; continue;
    }

    const ind = indentOf(line);
    if (ind < baseIndent) break;

    if (ind >= baseIndent + 2 && items.length) {
      // a nested run — hand the whole thing back to the block parser
      const nested = [];
      while (i < lines.length && (indentOf(lines[i]) >= baseIndent + 2 || !lines[i].trim())) {
        if (!lines[i].trim() && !(lines[i + 1] && indentOf(lines[i + 1]) >= baseIndent + 2)) break;
        nested.push(lines[i].slice(Math.min(baseIndent + 2, indentOf(lines[i])))); i++;
      }
      items[items.length - 1].children = parseBlocks(nested);
      continue;
    }

    const m = ordered ? RE.ordered.exec(line) : RE.bullet.exec(line);
    if (!m) {
      // switching from bullets to numbers (or back) starts a new list
      if (RE.bullet.test(line) || RE.ordered.test(line)) break;
      // otherwise it is a lazy continuation of the previous item
      if (items.length && ind >= baseIndent + 1) { items[items.length - 1].raw.push(line.trim()); i++; continue; }
      break;
    }

    const content = m[3];
    const item = { raw: [content], children: null, checked: null };
    const tm = RE.task.exec(content);
    if (tm) { item.checked = tm[1].toLowerCase() === 'x'; item.raw = [tm[2]]; }
    items.push(item);
    i++;
  }

  const listItems = items.map(it => ({
    text: it.raw.join(' ').trim(),
    children: it.children,
    checked: it.checked,
  }));
  return { list: { t: 'list', ordered, items: listItems }, next: i };
}

function buildContainer(rawType, title, lines) {
  const type = resolveType(rawType) || 'note';

  if (type === 'quiz') {
    const items = [];
    let cur = null;
    for (const raw of lines) {
      const qm = RE.qline.exec(raw), am = RE.aline.exec(raw);
      if (qm) { if (cur) items.push(cur); cur = { q: qm[1].trim(), a: '' }; }
      else if (am && cur) cur.a = (cur.a ? cur.a + '\n' : '') + am[1].trim();
      else if (cur && raw.trim()) { if (cur.a) cur.a += '\n' + raw.trim(); else cur.q += ' ' + raw.trim(); }
    }
    if (cur) items.push(cur);
    if (!items.length) {
      // fall back: "question ? answer" on alternating lines
      const clean = stripListMarkers(lines);
      for (let k = 0; k + 1 < clean.length; k += 2) items.push({ q: clean[k], a: clean[k + 1] });
    }
    return { t: 'quiz', title, items };
  }

  if (type === 'steps') {
    const items = [];
    let cur = null;
    for (const raw of lines) {
      if (!raw.trim()) continue;
      const bm = RE.bullet.exec(raw) || RE.ordered.exec(raw);
      if (bm) { if (cur) items.push(cur.trim()); cur = (bm[3] !== undefined ? bm[3] : bm[2]); }
      else if (cur !== null) cur += ' ' + raw.trim();
      else cur = raw.trim();
    }
    if (cur) items.push(cur.trim());
    return { t: 'steps', title, items };
  }

  if (type === 'compare') {
    const idx = lines.findIndex(l => /^\s*\|{3,}\s*$/.test(l));
    const leftLines = idx >= 0 ? lines.slice(0, idx) : lines;
    const rightLines = idx >= 0 ? lines.slice(idx + 1) : [];
    let [lt, rt] = title.split(/\s+(?:vs\.?|versus|\|)\s+/i);
    return {
      t: 'compare',
      left:  { title: (lt || 'This').trim(),  blocks: parseBlocks(leftLines) },
      right: { title: (rt || 'That').trim(), blocks: parseBlocks(rightLines) },
    };
  }

  if (type === 'definition') {
    const term = title || (lines[0] || '').trim();
    const rest = title ? lines : lines.slice(1);
    return { t: 'callout', type, title: '', term, blocks: parseBlocks(rest) };
  }

  if (type === 'formula') {
    const txt = lines.join('\n').trim();
    const looksLikeMath = txt && !/[.!?]\s/.test(txt) && txt.split('\n').length <= 4;
    return { t: 'callout', type, title, blocks: looksLikeMath ? [{ t: 'math', code: txt }] : parseBlocks(lines) };
  }

  return { t: 'callout', type, title, blocks: parseBlocks(lines) };
}

/* ---------------- inline parser ---------------- */

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s).replace(/[&<>"']/g, c => ESC[c]);

/**
 * Convert inline markdown to HTML. `ctx.img(src)` may return a resolved URL.
 */
export function inline(src = '', ctx = {}) {
  if (!src) return '';
  const stash = [];
  const keep = (html) => { stash.push(html); return `\u0000${stash.length - 1}\u0000`; };

  let s = String(src);

  // escaped characters
  s = s.replace(/\\([\\`*_{}\[\]()#+\-.!=~<>|$])/g, (_, c) => keep(esc(c)));

  // code spans first (never formatted inside)
  s = s.replace(/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g, (_, _t, code) =>
    keep(`<code>${esc(code.trim())}</code>`));

  // inline math
  s = s.replace(/\$([^$\n]+)\$/g, (_, m) => keep(`<span class="math">${esc(m)}</span>`));

  // images
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, (_, alt, src2, title) => {
    const url = ctx.img ? ctx.img(src2) : src2;
    return keep(`<img src="${esc(url)}" alt="${esc(alt)}" title="${esc(title || alt)}" loading="lazy" class="inline-img" />`);
  });

  // links
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, (_, text, href, title) => {
    const safe = /^(https?:|mailto:|tel:|#|\/)/i.test(href) ? href : '#';
    const ext = /^https?:/i.test(safe) ? ' target="_blank" rel="noopener noreferrer"' : '';
    return keep(`<a href="${esc(safe)}"${title ? ` title="${esc(title)}"` : ''}${ext}>${esc(text)}</a>`);
  });

  // bare urls
  s = s.replace(/(^|[\s(])((?:https?:\/\/)[^\s<>()]+[^\s<>().,;:!?])/g, (_, pre, url) =>
    pre + keep(`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(url.replace(/^https?:\/\//, ''))}</a>`));

  s = esc(s);

  // emphasis & friends (on escaped text — safe)
  s = s.replace(/==([^=]+)==/g, '<mark class="qmark">$1</mark>');
  s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  s = s.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[\s(\[{"'])\*([^*\n]+)\*(?=$|[\s)\]}.,;:!?"'])/g, '$1<em>$2</em>');
  s = s.replace(/(^|[\s(\[{"'])_([^_\n]+)_(?=$|[\s)\]}.,;:!?"'])/g, '$1<em>$2</em>');
  s = s.replace(/\^([^\s^]+)\^/g, '<sup>$1</sup>');
  s = s.replace(/(?<![\w\\])~([A-Za-z0-9+-]+)~(?![\w])/g, '<sub>$1</sub>');

  // line breaks
  s = s.replace(/  \n|\\\n/g, '<br />').replace(/\n/g, ' ');

  return s.replace(/\u0000(\d+)\u0000/g, (_, n) => stash[+n]);
}

/** Plain text of an inline string (for search, excerpts, flashcards). */
export function plain(src = '') {
  return String(src)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`~=]{1,3}/g, '')
    .replace(/\$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Outline entries (headings) with stable ids. */
export function outline(blocks) {
  const seen = new Map();
  const out = [];
  let n = 0;
  const walk = (bs) => {
    for (const b of bs) {
      if (b.t === 'h') {
        const base = plain(b.text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'section';
        const c = (seen.get(base) || 0) + 1;
        seen.set(base, c);
        out.push({ id: `h-${base}${c > 1 ? '-' + c : ''}`, level: b.level, text: plain(b.text), n: n++ });
      }
    }
  };
  walk(blocks);
  return out;
}

/** All Q/A pairs in a document, for flashcards. */
export function quizItems(blocks) {
  const out = [];
  const walk = (bs) => {
    for (const b of bs) {
      if (!b) continue;
      if (b.t === 'quiz') b.items.forEach(it => out.push(it));
      if (b.blocks) walk(b.blocks);
      if (b.left) { walk(b.left.blocks); walk(b.right.blocks); }
      if (b.items && b.t === 'list') b.items.forEach(it => it.children && walk(it.children));
    }
  };
  walk(blocks);
  return out;
}
