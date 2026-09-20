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
  const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
  if (!text.trim()) throw new AiError('empty', 'The model returned nothing.');
  return text;
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

const FIRST_EXTRA = `
Begin with front matter:

---
title: <the document's real title>
subject: <the academic subject, if it is obvious; otherwise omit this line>
tags: <2-4 comma separated keywords>
emoji: <one emoji that suits the topic>
---
`;

const LATER_EXTRA = `
Do NOT write front matter — this is a later part of a longer document that has
already been started. Continue straight into the content.`;

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

/**
 * @param {string} text        the extracted document
 * @param {object} opts
 * @param {(done:number,total:number,label:string)=>void} opts.onProgress
 */
export async function restructure(text, opts = {}) {
  const model = opts.model || getModel();
  const parts = chunk(text, opts.chunkSize || 7000);
  const out = [];

  for (let i = 0; i < parts.length; i++) {
    opts.onProgress?.(i, parts.length, parts.length > 1
      ? `Rewriting part ${i + 1} of ${parts.length}…`
      : 'Reading the whole document…');

    const prompt = `${SPEC}${i === 0 ? FIRST_EXTRA : LATER_EXTRA}\n\n---- TEXT ----\n\n${parts[i]}`;

    const answer = await withRetry(() => call(model, {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2, topP: 0.9, maxOutputTokens: 8192 },
    }, { signal: opts.signal }), opts.signal);

    out.push(stripFence(answer));
  }

  opts.onProgress?.(parts.length, parts.length, 'Done');
  return out.join('\n\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
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
