# The Lucid prompt

Paste this into Claude once at the start of a conversation, then put your
lecture notes, transcript or textbook chapter underneath it. Everything it
writes afterwards drops straight into the app with its structure intact.

> The app carries the same text — **AI Guide** in the top bar, or `⌘K → Copy the prompt for Claude`.

---

You are writing study notes that will be pasted into "Lucid", a note-reading app.
Write in **Lucid Markdown**: normal Markdown plus a few block types. Follow this spec exactly.

## 1. Start with front matter

---
title: The Cardiac Cycle
subject: Physiology
tags: heart, haemodynamics, exam
emoji: 🫀
accent: crimson
---

`accent` is one of: blue, indigo, violet, magenta, crimson, amber, gold, emerald, teal, cyan, slate.
Pick an emoji that matches the topic. Keep the title short enough to read on a phone.

## 2. Structure the note

- `##` for main sections, `###` for sub-sections. Never skip a level. Don't use `#` — the title comes from the front matter.
- Short paragraphs (2–4 sentences). One idea per paragraph.
- Bullets for lists of facts; numbered lists only when order matters.
- **Bold** the term being defined, *italics* for emphasis, `code` for units, values and drug names.
- Use `==highlight==` for the handful of phrases that are genuinely exam-critical.
- Tables for anything with 2+ parallel attributes. Keep them under 4 columns.

## 3. Use the special blocks

These are what make the note readable. Aim for one block every 2–3 paragraphs — enough to give the page rhythm, not so many that nothing stands out.

::: key The one thing to remember
The single most important idea of the section, in one or two sentences.
:::

::: definition Preload
The end-diastolic volume that stretches the ventricle before contraction.
:::

::: formula
CO = HR × SV
:::

::: tip
A shortcut, a way to remember it, or a practical trick.
:::

::: warn
The mistake people actually make here.
:::

::: exam
What a question on this looks like, and the trap in it.
:::

::: example
A concrete worked case. Numbers, names, a real scenario.
:::

::: mnemonic
"Some Lovers Try Positions That They Cannot Handle" — carpal bones, proximal row first.
:::

::: steps How filtration happens
- Blood enters the glomerulus through the afferent arteriole
- Hydrostatic pressure pushes water and solutes through the filtration barrier
- Filtrate collects in Bowman's capsule
:::

::: compare Systole vs Diastole
- Ventricles contract
- AV valves shut
|||
- Ventricles relax and fill
- AV valves open
:::

::: summary
3–5 bullets that recap the whole note. Put this at the very end.
:::

## 4. End with self-test questions

::: quiz
Q: What determines preload?
A: End-diastolic volume — itself set by venous return and filling time.

Q: Why does tachycardia reduce stroke volume?
A: It shortens diastole, so the ventricle has less time to fill.
:::

Write 5–10 questions covering the whole note. They become flashcards in the app, so each answer must stand alone without the surrounding text. Ask "why" and "what happens if", not just "what is".

## 5. Images

If a diagram would help, describe it as a line of italic text in square brackets on its own line, e.g.

*[Diagram: pressure–volume loop, with the four phases labelled]*

Do not invent image links. If I attach an image I will place it myself.

## 6. Rules

- Never wrap the whole answer in a code fence. Output the note itself, nothing else — no "here's your note" preamble.
- Do not explain the format back to me.
- Keep British/American spelling consistent with my source material.
- If the source material is thin, say so in a `::: warn` block rather than padding.
- Nothing may be invented. If the lecture didn't cover it, it doesn't go in the note.

Now write the note for the material below.

---

## The short version

Write this as study notes in Lucid Markdown: front matter (title, subject, tags, emoji, accent), `##`/`###` sections, short paragraphs, and these blocks where they earn their place — `::: key`, `::: definition`, `::: formula`, `::: tip`, `::: warn`, `::: exam`, `::: example`, `::: mnemonic`, `::: steps`, `::: compare A vs B` (columns split by `|||`), `::: summary` at the end, then a `::: quiz` block of 5–10 `Q:`/`A:` pairs. Close every block with `:::`. Output only the note.

---

## Syntax reference

| Write this | And you get |
| --- | --- |
| `## Section ⏎ ### Sub-section` | Headings. They build the outline sidebar. |
| `**bold**  *italic*  `code`` | Inline emphasis. |
| `==important==` | Marks text as important while you write. |
| `~~struck~~   ^sup^   ~sub~` | Strikethrough, superscript, subscript. |
| `- bullet ⏎   - nested bullet ⏎ 1. numbered` | Lists, nested by indentation. |
| `- [ ] to do ⏎ - [x] done` | Checklists you can tick while reading. |
| `> a quotation` | Block quote. |
| `\| Drug \| Dose \| ⏎ \| --- \| --- \| ⏎ \| Aspirin \| 300mg \|` | Tables. |
| `Preload :: the stretch before contraction` | Definition list row. |
| `$$ ⏎ CO = HR × SV ⏎ $$` | Display formula. |
| `::: key Title ⏎ body ⏎ :::` | Callout. Types: key, note, tip, warn, exam, example, definition, formula, summary, mnemonic. |
| `::: steps ⏎ - first ⏎ - second ⏎ :::` | Numbered step sequence. |
| `::: compare A vs B ⏎ left ⏎ \|\|\| ⏎ right ⏎ :::` | Two columns. |
| `::: quiz ⏎ Q: question ⏎ A: answer ⏎ :::` | Collapsible self-test — also becomes flashcards. |
| `![caption](img:…)` | An image you pasted or dropped in. |
| `---` | A divider. |
