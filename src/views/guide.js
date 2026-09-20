/* Lucid — the writing & AI format guide, with the prompt front and centre. */

import { $, el, copyText, mod } from '../core/util.js';
import { PROMPT, SHORT_PROMPT, SYNTAX } from '../core/prompt.js';
import { parse } from '../parse/lmd.js';
import { render as renderAst } from '../parse/render.js';
import { toast } from '../ui/ui.js';
import { go } from '../core/router.js';
import * as store from '../core/store.js';

let built = false;

const DEMO = `## Filtration in the nephron

Blood arrives under pressure and is pushed through a three-layer barrier. What gets through is called the **filtrate**.

::: key The one thing to remember
Filtration is passive. Nothing is pumped — hydrostatic pressure does all the work.
:::

::: definition Glomerular filtration rate
The volume of filtrate formed by both kidneys per minute. Normally \`125 mL/min\`.
:::

::: compare Afferent vs Efferent
- Carries blood *in*
- Wider bore
|||
- Carries blood *out*
- Narrower, so pressure stays high
:::

::: quiz
Q: Why does constricting the efferent arteriole raise GFR?
A: It traps blood in the glomerulus, so hydrostatic pressure — and therefore filtration — rises.
:::`;

export const view = {
  async mount() { if (!built) build(); },
};

function build() {
  built = true;
  const shell = $('#guide-shell');
  const { blocks } = parse(DEMO);
  const { html } = renderAst(blocks, { img: s => store.resolveImage(s) });

  shell.innerHTML = '';
  shell.append(el('div', { class: 'guide-inner' },

    el('header', { class: 'guide-hero' },
      el('h1', { text: 'Make Claude write it the right way' }),
      el('p', { text: 'Lucid reads a small set of extra blocks on top of ordinary Markdown. Give Claude the prompt below once at the start of a conversation and every summary after it will already be shaped for this app — sections, callouts, a recap and self-test questions you can revise from.' }),
    ),

    el('section', { class: 'guide-card' },
      el('h2', { text: 'The prompt' }),
      el('p', { text: 'Copy this, paste it into Claude, and put your lecture, transcript or textbook chapter underneath it.' }),
      el('div', { class: 'prompt-box' },
        el('pre', { text: PROMPT }),
        el('button', {
          class: 'btn btn-primary btn-sm copy-fab',
          onclick: () => copyText(PROMPT).then(ok => toast(ok ? 'Prompt copied' : 'Could not copy', { icon: 'copy', kind: ok ? 'ok' : 'err' })),
        }, el('span', { class: 'i', dataset: { icon: 'copy' } }), el('span', { text: 'Copy' })),
      ),
    ),

    el('section', { class: 'guide-card' },
      el('h2', { text: 'The short version' }),
      el('p', { text: 'For when you only need a nudge mid-conversation.' }),
      el('div', { class: 'prompt-box' },
        el('pre', { text: SHORT_PROMPT }),
        el('button', {
          class: 'btn btn-outline btn-sm copy-fab',
          onclick: () => copyText(SHORT_PROMPT).then(ok => toast(ok ? 'Copied' : 'Could not copy', { icon: 'copy', kind: ok ? 'ok' : 'err' })),
        }, el('span', { class: 'i', dataset: { icon: 'copy' } }), el('span', { text: 'Copy' })),
      ),
    ),

    el('section', { class: 'guide-card' },
      el('h2', { text: 'What it looks like' }),
      el('div', { class: 'demo-split' },
        el('div', {},
          el('p', { class: 'hint', style: { marginBottom: '8px' } , text: 'What you paste' }),
          el('pre', { style: { fontFamily: 'var(--font-mono)', fontSize: 'calc(.78rem * var(--font-scale))', lineHeight: '1.6', background: 'var(--bg)', border: 'var(--border-w) solid var(--line)', borderRadius: 'var(--radius-sm)', padding: 'var(--gap-3)', overflow: 'auto', maxHeight: '460px', whiteSpace: 'pre-wrap' }, text: DEMO })),
        el('div', {},
          el('p', { class: 'hint', style: { marginBottom: '8px' }, text: 'What you get' }),
          el('div', { class: 'prose', style: { background: 'var(--paper)', border: 'var(--border-w) solid var(--line)', borderRadius: 'var(--radius-sm)', padding: 'var(--gap-4)', maxHeight: '460px', overflow: 'auto' }, html }),
        ),
      ),
    ),

    el('section', { class: 'guide-card' },
      el('h2', { text: 'Every piece of syntax' }),
      el('p', { text: 'You can type any of this yourself in the editor — the toolbar inserts most of it for you.' }),
      el('div', { class: 'syntax-grid' },
        ...SYNTAX.map(s => el('div', { class: 'syntax-item' },
          el('code', { text: s.code }),
          el('span', { text: s.desc }))),
      ),
    ),

    el('section', { class: 'guide-card' },
      el('h2', { text: 'Working with images' }),
      el('p', { text: 'Paste an image straight into the editor with ' + mod() + 'V, or drag one in from Files. It is stored on this device with the note and never leaves it. Images from PowerPoint slides and Word documents come across automatically when you import them.' }),
      el('p', { class: 'hint', text: 'Tap any picture in a note to see it full size.' }),
    ),

    el('section', { class: 'guide-card' },
      el('h2', { text: 'Importing the ugly stuff' }),
      el('p', { text: 'Drop a PDF, a PowerPoint or a Word file on the import screen. Lucid pulls out the text, rejoins lines the PDF broke mid-sentence, repairs hyphenated words, drops page numbers and running headers, normalises the bullets, and promotes the bigger, bolder lines to headings. Slides keep their pictures and their speaker notes. Then you edit whatever it got wrong.' }),
      el('div', { class: 'empty-actions', style: { justifyContent: 'flex-start' } },
        el('button', { class: 'btn btn-primary', onclick: () => go('import') },
          el('span', { class: 'i', dataset: { icon: 'upload' } }), el('span', { text: 'Open import' }))),
    ),
  ));

  $('.view-guide .doc-bar').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    if (b.dataset.act === 'copy-prompt') copyText(PROMPT).then(ok => toast(ok ? 'Prompt copied' : 'Could not copy', { icon: 'sparkle', kind: ok ? 'ok' : 'err' }));
    if (b.dataset.act === 'back') go('library');
  });
}
