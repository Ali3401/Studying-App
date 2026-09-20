/* ==========================================================================
   Lucid — optional AI clean-up for imports.

   A PDF gives us the words in roughly the right order and nothing else: no
   idea which line was a heading, where one thought ends, or what was a list.
   A model reading the whole extracted text can work that out from context,
   which is the one thing the geometric heuristics cannot do.

   The key lives in this browser's localStorage and nowhere else. It is never
   committed, never sent anywhere but Google, and only text is ever uploaded —
   no page images, which is both cheaper and faster.
   ========================================================================== */

const KEY_STORE = 'lucid.ai.key';
const MODEL_STORE = 'lucid.ai.model';
const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta';

export const DEFAULT_MODEL = 'gemini-2.5-flash';

/* ---------------- the key ---------------- */

export function getKey() {
  try { return localStorage.getItem(KEY_STORE) || ''; } catch { return ''; }
}
export function setKey(key) {
  try {
    const clean = String(key || '').trim();
    if (clean) localStorage.setItem(KEY_STORE, clean);
    else localStorage.removeItem(KEY_STORE);
  } catch {}
}
export const hasKey = () => !!getKey();

export function getModel() {
  try { return localStorage.getItem(MODEL_STORE) || DEFAULT_MODEL; } catch { return DEFAULT_MODEL; }
}
export function setModel(m) {
  try { localStorage.setItem(MODEL_STORE, m || DEFAULT_MODEL); } catch {}
}

/**
 * Google AI Studio keys look like "AIzaSy…". Anything else is usually an
 * OAuth token or a key for a different product, and will fail with a confusing
 * message — so say so before the request is made.
 */
export function inspectKey(key = getKey()) {
  const k = String(key || '').trim();
  if (!k) return { ok: false, why: 'No key yet.' };
  if (/^AIza[0-9A-Za-z_-]{30,}$/.test(k)) return { ok: true };
  if (/^ya29\./.test(k)) return { ok: false, why: 'That is an OAuth access token, not an API key. They expire after an hour.' };
  if (/^AQ\./.test(k)) return { ok: false, why: 'That looks like a short-lived Google token rather than an AI Studio API key.' };
  return { ok: false, why: 'An AI Studio key normally starts with “AIza”. This one may be for a different product.' };
}

/* ---------------- talking to the model ---------------- */

/**
 * This is a formatting job, not a reasoning one, so the 2.5 models are asked
 * not to think: it is faster, it costs a fraction of the quota, and — because
 * thinking tokens come out of the same output budget — it stops long answers
 * being cut off half way. Older models do not know the field, so it is only
 * sent where it is understood, and dropped if it is refused anyway.
 */
const thinksOnDemand = (model) => /^gemini-2\.5-(flash|flash-lite)/i.test(model);

async function call(model, body, { signal } = {}) {
  const key = getKey();
  if (!key) throw new AiError('no-key', 'No API key saved yet.');

  let res;
  try {
    res = await fetch(`${ENDPOINT}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new AiError('network', 'Could not reach Google. Check the connection.');
  }

  if (res.status === 429) throw new AiError('rate', 'The free tier is rate limited — wait a moment and try again.');
  if (res.status === 400 || res.status === 403) {
    const detail = await res.json().catch(() => null);
    const msg = detail?.error?.message || '';
    if (/api.?key|API_KEY|credential|permission/i.test(msg)) {
      throw new AiError('key', 'Google rejected the key. Check it at aistudio.google.com/apikey.');
    }
    throw new AiError('request', msg || `Request refused (${res.status}).`);
  }
  if (!res.ok) throw new AiError('server', `Google returned ${res.status}.`);

  const data = await res.json();
  const blocked = data?.promptFeedback?.blockReason;
  if (blocked) throw new AiError('blocked', `The model declined to process that text (${blocked}).`);
  const cand = data?.candidates?.[0];
  const text = cand?.content?.parts?.map(p => p.text || '').join('') || '';
  if (!text.trim()) throw new AiError('empty', 'The model returned nothing.');
  return { text, finish: cand?.finishReason || '' };
}

/** One generation, with thinking off where the model supports switching it off. */
async function generate(model, prompt, { signal, maxOutputTokens = 8192, temperature = 0.2 } = {}) {
  const generationConfig = { temperature, topP: 0.9, maxOutputTokens };
  const body = { contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig };
  if (thinksOnDemand(model)) generationConfig.thinkingConfig = { thinkingBudget: 0 };

  try {
    return await call(model, body, { signal });
  } catch (e) {
    // a model that does not know the field says so; ask again without it
    if (e instanceof AiError && e.kind === 'request' && /thinking/i.test(e.message) && generationConfig.thinkingConfig) {
      delete generationConfig.thinkingConfig;
      return call(model, body, { signal });
    }
    throw e;
  }
}

export class AiError extends Error {
  constructor(kind, message) { super(message); this.kind = kind; this.name = 'AiError'; }
}

/** Which models this key can actually use, newest-looking first. */
export async function listModels(key = getKey()) {
  const res = await fetch(`${ENDPOINT}/models?key=${encodeURIComponent(key)}&pageSize=100`);
  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    throw new AiError('key', detail?.error?.message || `Could not list models (${res.status}).`);
  }
  const data = await res.json();
  return (data.models || [])
    .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map(m => ({
      id: String(m.name || '').replace(/^models\//, ''),
      label: m.displayName || m.name,
      input: m.inputTokenLimit,
    }))
    .filter(m => /gemini/i.test(m.id) && !/vision|embedding|aqa/i.test(m.id))
    .sort((a, b) => b.id.localeCompare(a.id));
}

export async function testKey() {
  const models = await listModels();
  if (!models.length) throw new AiError('key', 'The key works but no Gemini models are available to it.');
  return models;
}

/* ---------------- restructuring an import ---------------- */

const SPEC = `Rewrite the text below as clean study notes in "Lucid Markdown".

Lucid Markdown is ordinary Markdown plus these blocks:

::: key            the single most important idea of a section
::: definition     a term and its meaning
::: formula        an equation on its own
::: tip            a shortcut or a way to remember something
::: warn           a common mistake or a caution
::: exam           what a question on this looks like
::: example        a concrete case
::: mnemonic       a memory device that is in the source
::: steps          an ordered process, one step per "- " line
::: summary        3-5 bullets recapping the section
::: quiz           "Q: question" / "A: answer" pairs
Close every block with a line containing only :::

Rules, in order of importance:

1. NEVER invent, add, infer or embellish. Every fact must already be in the
   text. If something is garbled and you cannot tell what it meant, keep it
   as it is rather than guessing.
2. Do not summarise or shorten. Keep all the content. You are restructuring,
   not condensing.
3. Work out the structure from the meaning: which lines were headings, where
   one idea ends and the next begins, which runs of text were really a list,
   and which sentences were broken across lines and should be rejoined.
4. Use ## for sections and ### for sub-sections.
5. Only use a ::: block when the source material genuinely is that thing.
   A page of plain explanation should stay plain paragraphs. Do not decorate.
6. Fix obvious extraction damage: words split across lines, duplicated running
   headers, stray page numbers, bullet characters that came through as
   symbols or boxes.
7. Keep every ![caption](IMG:0) image reference exactly where it is, unchanged.
8. Output only the note. No preamble, no explanation, no code fence around it.`;

const FRONT_MATTER_SHAPE = `---
title: <the document's real title>
subject: <the academic subject, if it is obvious; otherwise omit this line>
tags: <2-4 comma separated keywords>
emoji: <one emoji that suits the topic>
---`;

const FIRST_EXTRA = `
Begin with front matter:

${FRONT_MATTER_SHAPE}
`;

const LATER_EXTRA = `
Do NOT write front matter — this is a later part of a longer document that has
already been started. Continue straight into the content.`;

/* ---------------- reading the whole thing first ----------------

   A long handout has to be sent in pieces, and a piece on its own has no
   idea what came before it: it re-titles the document half way through, or
   starts a section that was already open. So before any of it is rewritten,
   one cheap pass reads a skeleton of the entire document and comes back with
   what it is and how it is laid out. That answer then rides along with every
   piece, which is what lets them agree with each other. */

const SURVEY = `Below is a skeleton of a document extracted from a badly
formatted PDF: the lines are in order, but long lines are cut short and some
lines are missing. Work out what the document actually is.

Reply with exactly this and nothing else:

${FRONT_MATTER_SHAPE}

OUTLINE
- <each real section of the document, in order, titled the way it should be>

Rules:
- Never invent a section that is not in the text.
- Name sections the way the document names them, tidied up.
- Between 3 and 20 sections. If it has no sections at all, write "- (none)".`;

/**
 * A cheap stand-in for the whole document: every line in order, long ones
 * clipped, thinned evenly if it is still too big. Headings and labels are
 * short lines, so they nearly all survive — which is exactly the shape the
 * survey needs to see.
 */
export function skeleton(text, budget = 6000) {
  const lines = String(text).split('\n').map(l => l.trim()).filter(Boolean)
    .map(l => (l.length <= 90 ? l : l.slice(0, 88) + '…'));
  const joined = lines.join('\n');
  if (joined.length <= budget) return joined;

  // the opening pages carry the title, so they are never thinned
  const head = lines.slice(0, 30);
  const rest = lines.slice(30);
  const stride = Math.max(2, Math.ceil(joined.length / budget));
  const thinned = rest.filter((_, i) => i % stride === 0);
  return [...head, ...thinned].join('\n').slice(0, budget);
}

/** Pull the front matter block and the outline out of a survey answer. */
export function readSurvey(answer) {
  const text = stripFence(String(answer || ''));
  const fm = text.match(/^---\n([\s\S]*?)\n---/);
  const frontMatter = fm ? `---\n${fm[1].trim()}\n---` : '';
  const after = text.slice(fm ? fm[0].length : 0);
  const outline = (after.match(/^[ \t]*[-*]\s+(.+)$/gm) || [])
    .map(l => l.replace(/^[ \t]*[-*]\s+/, '').trim())
    .filter(l => l && !/^\(none\)$/i.test(l));
  return { frontMatter, outline };
}

export async function survey(text, opts = {}) {
  const model = opts.model || getModel();
  const prompt = `${SURVEY}\n\n---- SKELETON ----\n\n${skeleton(text, opts.budget || 6000)}`;
  const { text: answer } = await withRetry(
    () => generate(model, prompt, { signal: opts.signal, maxOutputTokens: 1500, temperature: 0.1 }),
    opts.signal);
  return readSurvey(answer);
}

/** Split on blank lines, packing into chunks a model can answer in one go. */
export function chunk(text, size = 7000) {
  const blocks = String(text).split(/\n{2,}/);
  const out = [];
  let cur = '';
  for (const block of blocks) {
    if (cur && cur.length + block.length + 2 > size) { out.push(cur); cur = ''; }
    // a single block longer than the budget has to be split on its own
    if (block.length > size) {
      if (cur) { out.push(cur); cur = ''; }
      for (let i = 0; i < block.length; i += size) out.push(block.slice(i, i + size));
      continue;
    }
    cur = cur ? `${cur}\n\n${block}` : block;
  }
  if (cur.trim()) out.push(cur);
  return out.length ? out : [String(text)];
}

const stripFence = (s) =>
  s.replace(/^\s*```(?:markdown|md)?\s*\n/i, '').replace(/\n```\s*$/, '').trim();

/** The ## and ### headings a rewritten piece produced, in order. */
export function headingsIn(markdown) {
  return (String(markdown).match(/^#{2,3}\s+(.+)$/gm) || [])
    .map(h => h.replace(/^#{2,3}\s+/, '').trim())
    .filter(Boolean);
}

/** What a later piece needs to know about the pieces before it. */
function contextFor({ plan, written, part, total }) {
  const lines = [];
  if (plan?.outline?.length) {
    lines.push('---- WHAT THIS DOCUMENT IS ----', '',
      'A first pass read the whole document and found these sections, in order:',
      ...plan.outline.map(h => `- ${h}`), '',
      'Use these titles where this part of the text reaches them. Do not start a',
      'section that belongs later, and do not repeat one that is already written.');
  }
  if (total > 1) {
    lines.push('', `This is part ${part} of ${total}.`);
    if (written.length) {
      lines.push('Sections already written: ' + written.slice(-8).map(h => `“${h}”`).join(', ') + '.',
        'If this text continues the last of those, carry straight on without',
        'repeating its heading.');
    }
  }
  return lines.length ? lines.join('\n') + '\n\n' : '';
}

/**
 * @param {string} text        the extracted document
 * @param {object} opts
 * @param {(done:number,total:number,label:string)=>void} opts.onProgress
 */
export async function restructure(text, opts = {}) {
  const model = opts.model || getModel();
  const size = opts.chunkSize || 7000;
  const parts = chunk(text, size);
  const out = [];
  const written = [];

  // One extra call buys every later piece a view of the whole document. It is
  // only worth it when there is more than one piece to keep in step.
  let plan = null;
  const steps = parts.length + (parts.length > 1 ? 1 : 0);
  let done = 0;

  if (parts.length > 1) {
    opts.onProgress?.(0, steps, 'Reading the whole document…');
    try {
      plan = await survey(text, { model, signal: opts.signal });
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      plan = null;               // a failed survey is not worth failing over
    }
    done = 1;
  }

  if (plan?.frontMatter) out.push(plan.frontMatter);

  for (let i = 0; i < parts.length; i++) {
    opts.onProgress?.(done + i, steps, parts.length > 1
      ? `Rewriting part ${i + 1} of ${parts.length}…`
      : 'Reading the whole document…');

    // front matter comes from the survey when there was one
    const extra = plan?.frontMatter ? LATER_EXTRA : (i === 0 ? FIRST_EXTRA : LATER_EXTRA);
    const context = contextFor({ plan, written, part: i + 1, total: parts.length });
    const piece = await rewritePiece(model, parts[i], `${SPEC}${extra}\n\n${context}`, opts, size);

    out.push(piece);
    written.push(...headingsIn(piece));
  }

  opts.onProgress?.(steps, steps, 'Done');
  return out.join('\n\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

/**
 * One piece, rewritten. If the answer ran out of room the piece was too big
 * to say in one go, so it is split and each half asked for separately rather
 * than handing back a note that stops mid-sentence.
 */
async function rewritePiece(model, source, preamble, opts, size, depth = 0) {
  const prompt = `${preamble}---- TEXT ----\n\n${source}`;
  const { text: answer, finish } = await withRetry(
    () => generate(model, prompt, { signal: opts.signal }), opts.signal);

  if (finish === 'MAX_TOKENS' && depth < 2 && source.length > 1200) {
    const halves = chunk(source, Math.ceil(source.length / 2));
    if (halves.length > 1) {
      const parts = [];
      for (const half of halves) {
        parts.push(await rewritePiece(model, half, `${SPEC}${LATER_EXTRA}\n\n`, opts, size, depth + 1));
      }
      return parts.join('\n\n');
    }
  }
  return stripFence(answer);
}

/** The free tier rate-limits rather than failing, so wait and try again. */
async function withRetry(fn, signal, tries = 3) {
  let wait = 2500;
  for (let attempt = 1; ; attempt++) {
    try { return await fn(); }
    catch (e) {
      if (e.name === 'AbortError') throw e;
      if (!(e instanceof AiError) || e.kind !== 'rate' || attempt >= tries) throw e;
      await new Promise((res, rej) => {
        const t = setTimeout(res, wait);
        signal?.addEventListener('abort', () => { clearTimeout(t); rej(new DOMException('aborted', 'AbortError')); }, { once: true });
      });
      wait *= 2;
    }
  }
}
