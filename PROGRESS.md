# Lucid — build progress

Working notes so any session can pick this up cold. Newest status at the top.

**Branch:** `claude/study-notes-display-app-2x6rkg` · **Repo:** `Ali3401/Studying-App`

---

## Status: the app is complete and working

Every feature the brief asked for is built, tested in a real browser
(Chromium via Playwright at desktop, iPad portrait/landscape and iPhone sizes),
and pushed. `node tools/selftest.mjs` passes 75/75.

### What exists

| Area | State |
| --- | --- |
| Library (search, subjects, sort, grid/list, pin, progress rings) | done |
| Reader (prose, callouts, outline, progress, find, focus mode) | done |
| Highlighting (5 colours, notes, relocation on edit, side panel) | done |
| Editor (split view, toolbar, live preview, image paste/drop, tidy) | done |
| Study (SM-2 flashcards from `::: quiz` + highlights) | done |
| Import (PDF, PPTX, DOCX, HTML, MD/TXT, images) | done |
| Appearance panel (8 themes, 8 fonts, ~20 live controls) | done |
| Command palette, keyboard shortcuts, shortcut sheet | done |
| Export (Markdown, self-contained HTML, JSON backup, print/PDF) | done |
| Offline (service worker), PWA manifest, icons | done |
| AI prompt + in-app format guide + PROMPT.md | done |
| Self-test suite, GitHub Pages workflow, README | done |

### How to run it

```bash
python3 -m http.server 8000     # then open http://localhost:8000
node tools/selftest.mjs         # 75 assertions, no browser needed
```

### Deploying

`.github/workflows/pages.yml` runs the self test then publishes to GitHub
Pages. **It only works once Pages is switched on:** repo → Settings → Pages →
Build and deployment → Source: **GitHub Actions**. That is a human step; the
workflow cannot enable it.

---

## Architecture, in one screen

- **No build step.** Plain HTML + CSS + ES modules. `vendor/` holds pdf.js and
  JSZip so nothing is fetched at runtime and it all works offline.
- **`styles/tokens.css`** is the single source of visual truth — themes,
  accents, font presets, spacing, motion. The Appearance panel writes CSS
  custom properties onto `<html>`; nothing re-renders.
- **`src/parse/lmd.js`** parses Lucid Markdown → AST. **`src/parse/render.js`**
  turns the AST into HTML and stamps a sequential `data-bid` on every
  text-bearing element.
- **Highlights** anchor to `(data-bid, start, end)` *and* store their text, so
  they re-find themselves after an edit (`src/core/highlights.js`).
- **Storage** is IndexedDB via `src/core/db.js`, with a localStorage fallback
  if the browser blocks it. Images are Blobs; `img:<id>` refs resolve to object
  URLs at render time.
- **Views** register with a hash router (`src/core/router.js`); each exports
  `{ mount, unmount, refresh }`.

---

## Bugs found and fixed while building (don't reintroduce these)

1. **New flashcards were skipped on their first session.** `build()` captured
   `now` before `syncCards()` created cards with `due: Date.now()`, so cards
   born a millisecond later failed `due <= now`. New cards now get `due: 0`
   and the cutoff is taken after syncing.
2. **Content vanished below 1000px.** The outline/notes panels become
   `position: fixed` overlays, which takes them out of the grid flow, so
   `.read-main` landed in the zero-width first column. The media query now
   gives the shell a single `1fr` track.
3. **Typography ate newlines.** `\s+([,.;:!?])` collapsed the blank line before
   `:::` and `![`, destroying containers and image refs on every import.
   Typography now runs per line and skips structural lines entirely.
4. **`:::` lines were stripped as page furniture** — they repeat often enough
   to look like a running header. Structural lines are now exempt.
5. **Re-running the clean-up double-wrapped things.** `outsideContainers()`
   now runs heading/callout/quiz detection only outside existing `:::` blocks.
6. **A bullet list swallowed a following numbered list.** `parseList` now ends
   the list when the marker kind changes at the same indent.
7. **Escape in the find bar also left the note.** The input's handler now calls
   `stopPropagation()`.
8. **CSS custom properties set through `el({style})` were silently dropped** —
   `Object.assign` on a `CSSStyleDeclaration` does not set `--x`. This had
   killed the highlight colour chips, the accent dots and the card accent
   rings. `el()` now uses `setProperty` for `--` keys.
9. **The editor's title field lost to the front matter.** Commit now compares a
   front-matter snapshot: if the source's front matter changed, it wins;
   otherwise the fields win and get written back.
10. **Pinned notes did not sort first** when another note had
    `pinned: undefined`. Coerced in `normalize()` and in the comparator.
11. **`null` printed into the page.** `el()` skips null children but
    `Element.append()` stringifies them, so a note with no subject or no
    quiz rendered the word "null". Use `add()` from `core/util.js` for any
    append with a conditional child.
12. **Nothing looked due until you had already studied.** Cards only exist
    once `syncCards()` has run, so a freshly imported note with ten quiz
    questions reported zero due. `dueCountFor()` counts the questions that
    have no card yet, and every counter goes through it.

---

## Things deliberately not done

- No backend, no accounts, no sync. Everything is on-device by design.
- No LaTeX engine — `$…$` renders as styled monospace, not typeset maths.
- Scanned PDFs are not OCR'd; the importer detects them and offers page images.
- EMF/WMF images inside Office files are skipped (browsers can't display them).

---

## If you are picking this up

1. `node tools/selftest.mjs` first — it catches parser and clean-up
   regressions without a browser.
2. Serve the folder and click through: library → reader → select text →
   highlight → edit → study → import.
3. Keep this file current, and commit after each meaningful step.

---

## Polish list (work top-down, commit each one)

Ordered by how much they actually matter to someone using this to study.

1. ~~**Ask for persistent storage.**~~ Done — `src/core/safety.js` asks at
   boot; the Data panel reports whether it was granted and explains that
   adding to the Home Screen is what wins it on Safari.
2. ~~**Backup nudge.**~~ Done — a toast offers a one-tap export once there are
   3+ notes and it has been two weeks, at most once every three days.
3. ~~**Tag filtering.**~~ Done — a tag row under the subjects, scoped to the
   subject in view; tags on the cards are buttons too; multiple tags narrow
   (AND), and the empty state names what it looked for.
4. ~~**Next / previous note in the reader.**~~ Done — cards at the foot of
   every note, `[` and `]` on the keyboard, ordered naturally so "Lecture 2"
   comes before "Lecture 10".
5. ~~**Study a single subject.**~~ Done — `#/study?subject=…`, reachable from
   the Study button while a subject is filtered, and from the palette
   ("Study Physiology · 7 due"). The finished screen offers the other
   subjects that still have cards waiting.
6. ~~**Archive UI.**~~ Done — an Archive item in the note menu, an "Archived"
   chip that switches the library into an archive view, and Undo on the
   toast.
7. **Focus handling in overlays.** Trap Tab inside the sheet and the palette,
   and return focus to whatever opened them.
8. **Study stats.** Partly done — the finished screen shows due now / this
   week / total, and subject chips carry a due badge. A streak is still open.
9. **Reader gestures.** Swipe from the left edge to open the outline on
   iPad.
10. **Duplicate detection.** Warn before creating a second copy of a note that
    was pasted twice.
