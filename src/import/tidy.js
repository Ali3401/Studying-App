/* ==========================================================================
   Lucid — tidy: turn the mess that comes out of a PDF, a slide deck or a
   copy-paste into something with a shape. Every step is optional so the
   import screen can show you what it is about to do.
   ========================================================================== */

const BULLET_CHARS = '•●▪▫◦‣∙·–—*+o';
const RE_BULLET = new RegExp(`^\\s*([${BULLET_CHARS}])\\s+`);
const RE_NUM = /^\s*(\d{1,3})[.)]\s+/;
const RE_LETTER = /^\s*([a-hj-z])[.)]\s+/i;

export const DEFAULT_OPTS = {
  unwrap: true, hyphen: true, headings: true, bullets: true,
  furniture: true, quotes: true, callouts: true, quiz: true,
};

export function tidy(text, opts = {}) {
  const o = { ...DEFAULT_OPTS, ...opts };
  let t = String(text || '').replace(/\r\n?/g, '\n');

  t = t.replace(/ /g, ' ').replace(/[​-‍﻿]/g, '').replace(/\f/g, '\n\n');
  t = t.replace(/[ \t]+$/gm, '');

  if (o.furniture) t = stripFurniture(t);
  if (o.hyphen) t = repairHyphens(t);
  if (o.bullets) t = normaliseBullets(t);
  if (o.unwrap) t = unwrap(t);
  if (o.headings) t = outsideContainers(t, detectHeadings);
  if (o.quotes) t = typography(t);
  if (o.callouts) t = outsideContainers(t, detectCallouts);
  if (o.quiz) t = outsideContainers(t, detectQuiz);

  return t.replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '').trimEnd() + '\n';
}

/* ---------------- steps ---------------- */

/**
 * Run a transform only on the parts of the text that are NOT already inside a
 * ::: block. Without this, re-running the clean-up would wrap things that are
 * already wrapped.
 */
export function outsideContainers(t, fn) {
  const lines = t.split('\n');
  const segments = [];
  let depth = 0;
  let cur = { inside: false, lines: [] };
  const flush = () => { if (cur.lines.length) segments.push(cur); };

  for (const line of lines) {
    const m = /^\s*:{3,}\s*(\S*)/.exec(line);
    if (m) {
      const opening = !!m[1];
      if (opening) {
        if (depth === 0) { flush(); cur = { inside: true, lines: [] }; }
        depth++;
        cur.lines.push(line);
        continue;
      }
      depth = Math.max(0, depth - 1);
      cur.lines.push(line);
      if (depth === 0) { flush(); cur = { inside: false, lines: [] }; }
      continue;
    }
    cur.lines.push(line);
  }
  flush();

  return segments
    .map(seg => (seg.inside ? seg.lines : fn(seg.lines.join('\n')).split('\n')))
    .flat()
    .join('\n');
}

/** Lines that carry structure are never furniture. */
const STRUCTURAL = /^\s*(:{3,}|`{3,}|\|{1,3}|#{1,6}\s|>|!\[|\$\$|[-*_]\s|\d{1,3}[.)]\s|[-*_]{3,}\s*$)/;

export function stripFurniture(t) {
  const lines = t.split('\n');
  // lines that repeat on many "pages" are running heads/feet
  const counts = new Map();
  for (const l of lines) {
    const k = l.trim();
    if (STRUCTURAL.test(k)) continue;
    if (k.length > 2 && k.length < 90) counts.set(k, (counts.get(k) || 0) + 1);
  }
  const pageish = Math.max(3, Math.round(lines.length / 45));
  const repeated = new Set(Array.from(counts).filter(([, n]) => n >= pageish).map(([k]) => k));

  return lines.filter(line => {
    const s = line.trim();
    if (!s) return true;
    if (STRUCTURAL.test(s)) return true;
    if (/^(page\s*)?\d{1,4}(\s*(of|\/)\s*\d{1,4})?$/i.test(s)) return false;
    if (/^[-–—]\s*\d{1,4}\s*[-–—]$/.test(s)) return false;
    if (/^\d{1,3}\s*\|\s*page$/i.test(s)) return false;
    if (/^(confidential|all rights reserved|©|copyright)\b/i.test(s) && s.length < 80) return false;
    if (repeated.has(s) && s.length < 70 && !/[.!?]$/.test(s)) return false;
    return true;
  }).join('\n');
}

export function repairHyphens(t) {
  return t
    .replace(/([\p{Ll}])-\n\s*([\p{Ll}])/gu, '$1$2')
    .replace(/([\p{Ll}])‐\n\s*([\p{Ll}])/gu, '$1$2')
    .replace(/([\p{L}])-\s*\n\s*([\p{Ll}]{2,})/gu, (m, a, b) => a + b);
}

export function normaliseBullets(t) {
  const lines = t.split('\n');
  const custom = detectBulletGlyphs(lines);
  return lines.map(line => {
    const indent = (/^(\s*)/.exec(line)[1] || '').replace(/\t/g, '  ');
    let s = line.trimStart();
    if (custom.size) {
      const first = s.charAt(0);
      if (custom.has(first) && /^\S\s+\S/.test(s)) s = '- ' + s.slice(1).trimStart();
    }
    if (RE_BULLET.test(' ' + s)) s = s.replace(new RegExp(`^[${BULLET_CHARS}]\\s+`), '- ');
    else if (/^o\s{2,}/.test(s)) s = s.replace(/^o\s+/, '- ');
    else if (RE_NUM.test(s)) s = s.replace(RE_NUM, (m, n) => `${n}. `);
    else if (RE_LETTER.test(s) && indent.length >= 2) s = s.replace(RE_LETTER, '- ');
    return indent + s;
  }).join('\n');
}

/**
 * Broken PDF encodings turn bullets into whatever glyph happens to sit at that
 * byte — a curly quote, a tilde, a box. If some odd character opens three or
 * more lines, it was a bullet.
 */
function detectBulletGlyphs(lines) {
  const counts = new Map();
  for (const line of lines) {
    const s = line.trimStart();
    const c = s.charAt(0);
    if (!c || !/^\S\s+\S/.test(s)) continue;
    if (/[\p{L}\p{N}]/u.test(c)) continue;
    if ('#>|`$!["\'(*+-_=.,:;/\\'.includes(c)) continue;
    if (BULLET_CHARS.includes(c)) continue;
    counts.set(c, (counts.get(c) || 0) + 1);
  }
  const out = new Set();
  for (const [c, n] of counts) if (n >= 3) out.add(c);
  return out;
}

/** Rejoin lines that a PDF broke mid-sentence. */
export function unwrap(t) {
  const lines = t.split('\n');
  const widths = lines.filter(l => l.trim().length > 20).map(l => l.trimEnd().length).sort((a, b) => a - b);
  const typical = widths.length ? widths[Math.floor(widths.length * 0.75)] : 80;
  const threshold = Math.max(36, typical * 0.62);

  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const cur = lines[i];
    const s = cur.trim();
    if (!s) { out.push(''); continue; }

    if (isStructural(s)) { out.push(cur); continue; }

    let joined = cur.trimEnd();
    while (i + 1 < lines.length) {
      const nxt = lines[i + 1];
      const ns = nxt.trim();
      if (!ns) break;
      if (isStructural(ns)) break;
      const prev = joined.trim();
      // a line that ends a sentence and is not obviously wrapped ends the paragraph
      if (/[.!?:;"”’)]$/.test(prev) && prev.length < typical * 0.95) break;
      if (prev.length < threshold && !/[,;–—-]$/.test(prev)) break;
      if (/^[A-Z][a-z]+ \d{1,2}[,.]/.test(ns)) break;
      joined = joined.replace(/\s+$/, '') + ' ' + ns;
      i++;
    }
    out.push(joined);
  }
  return out.join('\n');
}

function isStructural(s) {
  return /^(#{1,6}\s|>\s|:::|```|\||---|\*\*\*|===)/.test(s)
    || /^(\s*)(- |\d{1,3}\. )/.test(s)
    || /^!\[/.test(s)
    || /^(Q|A)\s*[:.]/i.test(s);
}

/** Promote short, punctuation-free lines that look like titles. */
export function detectHeadings(t) {
  const lines = t.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const s = lines[i].trim();
    const prevBlank = !out.length || !out[out.length - 1].trim();
    const nextLine = (lines[i + 1] || '').trim();

    if (!s || s.startsWith('#') || isStructural(s) || s.length > 84) { out.push(lines[i]); continue; }
    if (!prevBlank) { out.push(lines[i]); continue; }

    const words = s.split(/\s+/).length;
    const endsClean = !/[.,;:!?]$/.test(s);
    const numbered = /^(\d+(\.\d+)*)[.)]?\s+\S/.test(s);
    const chapterish = /^(chapter|section|part|unit|lecture|topic|module|week|lesson)\b/i.test(s);
    const allCaps = s === s.toUpperCase() && /[A-Z]{3}/.test(s) && words <= 12;
    const titleCase = words <= 10 && endsClean && /^[A-Z]/.test(s) &&
      s.split(/\s+/).filter(w => /^[A-Z]/.test(w)).length >= Math.ceil(words * 0.55);
    const followed = nextLine && !/^#/.test(nextLine);

    if ((chapterish || allCaps) && endsClean) {
      out.push('## ' + tidyHeading(s));
    } else if (numbered && endsClean && words <= 12) {
      const depth = (/^(\d+(?:\.\d+)*)/.exec(s)[1].match(/\./g) || []).length;
      out.push('#'.repeat(Math.min(4, 2 + depth)) + ' ' + tidyHeading(s));
    } else if (titleCase && followed && words >= 2) {
      out.push('### ' + tidyHeading(s));
    } else {
      out.push(lines[i]);
    }
  }
  return out.join('\n');
}

const tidyHeading = (s) => {
  let h = s.replace(/^\s*(chapter|section|part|unit|lecture|topic|module|week|lesson)\s+(\d+[.:)]?)\s*[-–—:]?\s*/i,
    (m, w, n) => `${w[0].toUpperCase() + w.slice(1).toLowerCase()} ${n.replace(/[.:)]$/, '')} · `);
  h = h.replace(/\s*[·:]\s*$/, '');
  if (h === h.toUpperCase() && h.length > 3) {
    h = h.toLowerCase().replace(/(^|\s|·\s)(\p{L})/gu, (m) => m.toUpperCase());
  }
  return h.trim();
};

export function typography(t) {
  const parts = t.split(/(```[\s\S]*?```)/g);
  return parts.map((chunk, i) => {
    if (i % 2) return chunk;             // leave fenced code alone
    return chunk.split('\n').map(line => {
      // never reshape a line that carries structure — ::: blocks, tables,
      // images and headings must survive verbatim
      if (/^\s*(:{3,}|\||#{1,6}\s|!\[|>|\$\$|\|{3})/.test(line)) return line;
      return line
        .replace(/(`[^`]*`)|(?:(^|[\s([{])"(?=\S))/g, (m, code, pre) => code || pre + '\u201c')
        .replace(/(`[^`]*`)|"/g, (m, code) => code || '\u201d')
        .replace(/(^|[\s([{])'(?=\S)/g, '$1\u2018')
        .replace(/(\p{L})'(\p{L})/gu, '$1\u2019$2')
        .replace(/'/g, '\u2019')
        .replace(/(\S)\s--\s(\S)/g, '$1 \u2014 $2')
        .replace(/(\d)\s*-\s*(\d)/g, '$1\u2013$2')
        .replace(/\.\.\./g, '\u2026')
        .replace(/(\S)[ \t]+([,;:.!?])(?=[\s)\]}]|$)/g, '$1$2')
        .replace(/([\p{Ll}]),(?=[\p{L}])/gu, '$1, ');
    }).join('\n');
  }).join('');
}

const CALLOUT_WORDS = [
  [/^(key\s*point|key\s*idea|takeaway|main\s*point|important|crucial)\b[:\-–—]\s*/i, 'key'],
  [/^(note|nb|n\.b\.)\b[:\-–—]\s*/i, 'note'],
  [/^(tip|hint|trick|shortcut|pro\s*tip)\b[:\-–—]\s*/i, 'tip'],
  [/^(warning|caution|careful|beware|common\s*(mistake|error)|pitfall)\b[:\-–—]\s*/i, 'warn'],
  [/^(exam|exam\s*tip|test\s*tip|in\s*the\s*exam)\b[:\-–—]\s*/i, 'exam'],
  [/^(example|e\.g\.|for\s*example|case)\b[:\-–—]\s*/i, 'example'],
  [/^(definition|def|defined\s*as)\b[:\-–—]\s*/i, 'definition'],
  [/^(formula|equation)\b[:\-–—]\s*/i, 'formula'],
  [/^(summary|in\s*summary|recap|to\s*summarise|to\s*summarize|conclusion)\b[:\-–—]?\s*/i, 'summary'],
  [/^(mnemonic|remember\s*it\s*as)\b[:\-–—]\s*/i, 'mnemonic'],
];

export function detectCallouts(t) {
  const blocks = t.split(/\n{2,}/);
  return blocks.map(b => {
    const s = b.trim();
    if (!s || s.startsWith(':::') || s.startsWith('#') || s.startsWith('```')) return b;
    for (const [re, type] of CALLOUT_WORDS) {
      if (re.test(s)) {
        let body = s.replace(re, '').trim();
        if (!body || body.length < 3) return b;
        body = body.charAt(0).toUpperCase() + body.slice(1);
        return `::: ${type}\n${body}\n:::`;
      }
    }
    return b;
  }).join('\n\n');
}

export function detectQuiz(t) {
  const lines = t.split('\n');
  const out = [];
  let buf = [];
  const flush = () => {
    if (buf.length >= 2) {
      out.push('::: quiz');
      out.push(...buf);
      out.push(':::');
    } else out.push(...buf);
    buf = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const s = lines[i].trim();
    const qm = /^(?:\*\*)?Q(?:uestion)?(?:\s*\d+)?(?:\*\*)?\s*[:.)]\s*(.+)$/i.exec(s);
    const am = /^(?:\*\*)?A(?:nswer)?(?:\s*\d+)?(?:\*\*)?\s*[:.)]\s*(.+)$/i.exec(s);
    if (qm) { buf.push(`Q: ${qm[1].trim()}`); continue; }
    if (am && buf.length) { buf.push(`A: ${am[1].trim()}`); continue; }
    if (!s && buf.length) continue;
    if (buf.length) flush();
    out.push(lines[i]);
  }
  if (buf.length) flush();
  return out.join('\n');
}

/** Cheap language-agnostic title guess for an imported file. */
export function guessTitle(text, fallback = 'Imported note') {
  const lines = String(text).split('\n').map(l => l.trim()).filter(Boolean);
  for (const l of lines.slice(0, 12)) {
    const s = l.replace(/^#+\s*/, '');
    if (s.length >= 4 && s.length <= 90 && !/^(page|slide|chapter)\s*\d+$/i.test(s) && !/^[-•*]/.test(s)) {
      return s.replace(/\s*[.:;,]$/, '');
    }
  }
  return fallback;
}

/** A subject guess from a filename like "PHYS-201 Lecture 4 Cardiac.pdf". */
export function guessSubject(filename = '') {
  const base = filename.replace(/\.[^.]+$/, '');
  const m = /^([A-Z]{2,5}[\s-]?\d{2,4})/.exec(base);
  if (m) return m[1].replace(/[\s-]+/g, ' ').trim();
  const words = base.split(/[-_\s]+/).filter(w => w.length > 2 && !/^\d+$/.test(w));
  return words.length ? words[0].replace(/^./, c => c.toUpperCase()) : '';
}
