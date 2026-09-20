/* Writes PROMPT.md from the single source of truth in src/core/prompt.js. */
import fs from 'node:fs';
import { PROMPT, SHORT_PROMPT, SYNTAX } from '../src/core/prompt.js';

const md = `# The Lucid prompt

Paste this into Claude once at the start of a conversation, then put your
lecture notes, transcript or textbook chapter underneath it. Everything it
writes afterwards drops straight into the app with its structure intact.

> The app carries the same text — **AI Guide** in the top bar, or \`⌘K → Copy the prompt for Claude\`.

---

${PROMPT}

---

## The short version

${SHORT_PROMPT}

---

## Syntax reference

| Write this | And you get |
| --- | --- |
${SYNTAX.map(s => `| \`${s.code.replace(/\n/g, ' ⏎ ').replace(/\|/g, '\\|')}\` | ${s.desc.replace(/\|/g, '\\|')} |`).join('\n')}
`;

fs.writeFileSync(new URL('../PROMPT.md', import.meta.url), md);
console.log('PROMPT.md written');
