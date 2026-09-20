# Lucid — build progress

Working notes so any session can pick this up cold. Newest status at the top.

**Branch:** `claude/study-notes-display-app-2x6rkg` · **Repo:** `Ali3401/Studying-App`

---

## Status: the app is complete and working

Every feature the brief asked for is built, tested in a real browser
(Chromium via Playwright at desktop, iPad portrait/landscape and iPhone sizes),
and pushed. `node tools/selftest.mjs` passes 107/107, and fourteen browser
suites run clean with no console errors.

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

### Live now as a Claude Artifact

https://claude.ai/artifact/AWd8E2YFkWvhPi8rcEaFRy — private to the owner,
usable immediately. Note that an artifact has its own browser origin, so its
notes are a **separate store** from a GitHub Pages copy; move between them
with Appearance → Data → Export / Restore.

Publishing there needs `node tools/escape-vendor.mjs <dir>` first: the host
rejects text files containing raw control bytes, and pdf.js's minified worker
embeds 30 of them (plus 11 in JSZip) inside string literals that build binary
font tables. The script rewrites each as `\xNN`, which the JS parser treats
identically — verified by running the PDF and PowerPoint import tests against
the escaped copies. The vendored originals stay byte-identical to npm.

### Live on GitHub Pages ✅

**https://ali3401.github.io/Studying-App/** — the repository was made public
and Pages switched on, and every push now deploys automatically from
`claude/study-notes-display-app-2x6rkg` (which is the default branch, so no
merge is needed).

Note that it is served from a **sub-path**, `/Studying-App/`. Every reference
in the app is relative for that reason — `./src/main.js`, `../sw.js` through
`import.meta.url`, `scope: './'` — so nothing may be rewritten to a
root-absolute path without breaking the deployment. There is a sub-path test
harness: copy the repo to `/tmp/pagesim/Studying-App`, serve `/tmp/pagesim`,
and load `http://127.0.0.1:8788/Studying-App/`. It catches exactly this.

`.github/workflows/pages.yml` runs the self test, then publishes. It keeps a
guard step that checks Pages is switched on and fails with a readable message
if it is not, because a workflow token cannot enable Pages itself — the
create-Pages-site API returns `Resource not accessible by integration`, with
or without `configure-pages`' `enablement: true`.

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
15. **`.stat span` styled the spans inside `<b>` too**, so the streak number
    came out small and grey. Child selectors (`.stat > b`, `.stat > span`).
16. **`fmtDate` called every future moment "just now"** — it measures elapsed
    time, so a negative difference fell into the first branch. `fmtUntil()`
    handles the other direction.
17. **Every bullet vanished from Word-exported PDFs.** Word and PowerPoint
    draw bullets with the Symbol font, whose glyphs pdf.js returns in the
    Private Use Area (U+F0B7 is Symbol's bullet). They are not whitespace, so
    they survived trimming and silently became the first character of the
    line, taking the line's left edge with them. Stripped now, and treated as
    the bullet they were.
18. **Bold was never detected in any PDF.** The test was
    `/bold/i.test(item.fontName)`, but `fontName` is an internal id like
    `g_d0_f1`. The real font needs `page.commonObjs.get(name)`, which is only
    populated once `getOperatorList()` has run — 206ms for a 25-page deck, so
    it now always does. Bold-at-body-size is the main heading signal in a
    typed handout.
19. **Heading levels came from absolute size ratios**, so a handout that
    separates headings by two points made everything an h4. Ranked by size
    around the *heaviest* heading size instead.
22. **A scripted edit silently did nothing.** A `str.replace` anchored on
    `add(root,` found no match because that function still used
    `root.append(`, so a whole settings section never rendered and nothing
    errored. Patch scripts now assert their anchor exists before writing.
21. **The service worker never registered, so offline never worked.**
    Registration was deferred with `addEventListener('load', …)`, but `boot()`
    is async and finishes *after* the load event has already fired, so the
    listener was attached to an event that would never come again. It now
    checks `document.readyState` first. Verified by disabling the network and
    reloading: 44 files cached, app still opens.
20. **`imgDraws` is not a "has a diagram" signal.** PowerPoint renders
    gradients, shadows and its own bullets as images, so an ordinary text
    slide drew 69 of them while a real graph drew 2. Judging a page by the
    shape of its text works; counting its pictures does not.
14. **The paste handler could throw.** It called `e.target.closest(...)`,
    and a paste whose target is not an element (`window`, `document`) has no
    such method. Guarded.
13. **Focus never came back from a dialog.** Chrome does not always blur
    what is inside an element you hide, so the "has focus moved somewhere
    real?" guard saw focus still inside the closed dialog and skipped the
    restore. It now treats focus inside the container, on `body`, or
    nowhere as stranded.
12. **Nothing looked due until you had already studied.** Cards only exist
    once `syncCards()` has run, so a freshly imported note with ten quiz
    questions reported zero due. `dueCountFor()` counts the questions that
    have no card yet, and every counter goes through it.

21. **A patch script truncated a stylesheet to nothing.** `open(p, 'w')` opens
    and empties the file *before* `write()` runs, so a `TypeError` in the
    expression being written leaves a zero-byte file and no error about the
    file itself. Patch scripts now build the whole string, assert every anchor
    matched, write to `path.tmp` and `os.replace()` it into place.
22. **`pageOf()` lied during a turn.** It measured an element against the
    window and added `index * step`, which assumes the sheet's translate has
    already settled. Mid-turn it has not, so the outline highlight and the
    running head could name the wrong page. It now measures the element
    against the sheet — both move together, so the difference is stable.
23. **The gutter and the page edges cannot be painted on the sheet.** The
    sheet is what translates, so a spine drawn on it slides away with the
    text. Everything that belongs to the *book* rather than to the *text* —
    paper, corners, shadow, cut edges, spine, running head, folio — lives on
    `.page-frame`, which never moves.
24. **Black shadows disappear on dark stock.** The page edges and the turn
    shadow were `rgb(0 0 0 / …)`, invisible on a dark theme's paper. They are
    now `color-mix(in srgb, var(--ink) …%, transparent)`, which darkens white
    paper and lightens dark paper — either way the eye sees an edge.
25. **Easing a travelling band makes it invisible.** The turn shadow was
    sharing the sheet's ease-out, so it crossed 85% of the page in the first
    third of the animation and looked like a flicker. The sheet keeps its
    easing; the band crosses linearly.

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

## AI clean-up (optional)

`src/core/ai.js` sends the extracted text to Gemini and asks it to restructure
it into Lucid Markdown. This is the one thing the geometric heuristics cannot
do: work out from *meaning* which line was a heading and where a thought ends.

- **The key is never in the repository.** It lives in this browser's
  localStorage, entered in Appearance → Data. The repo is public; a committed
  key would be readable by anyone and flagged by secret scanning within
  minutes.
- **Only text is uploaded**, never page images — cheaper, faster, and well
  inside the free tier. PDF pictures now default to None for the same reason.
- **A long document is read whole before any of it is rewritten.** A piece on
  its own has no idea what came before it, so it re-titles the document half
  way through or reopens a section that is already written. One cheap survey
  call sends a *skeleton* of the entire document — every line in order, long
  lines clipped, thinned evenly if it is still too big, so headings survive —
  and gets back the front matter and an outline of the real sections. That
  plan then rides along with every piece, together with the headings already
  written, which is what keeps them agreeing with each other. The survey only
  runs when there is more than one piece to keep in step.
- Long documents are split into ~7000-character chunks at blank lines (the
  splitter is tested for losslessness).
- **Thinking is switched off** on the 2.5 models (`thinkingBudget: 0`). This is
  a formatting job, not a reasoning one; it is faster, it costs a fraction of
  the quota, and — because thinking tokens come out of the same output budget —
  it stops long answers being cut off half way. Models that do not know the
  field say so, and the call is retried without it.
- If an answer still comes back `MAX_TOKENS`, that piece was too big to say in
  one go: it is split in half and each half asked for separately, rather than
  handing back a note that stops mid-sentence.
- **It runs itself.** Getting a badly set handout into shape is the whole point
  of the app, so when a key is saved the rewrite starts as soon as a PDF,
  PowerPoint or Word file has been read. The checkbox under Understanding
  turns that off; changing the picture mode re-parses without spending another
  round of quota. Dropping *several* files at once still does not — that
  is a straight-to-library batch, and ten lectures would be thirty calls and
  several minutes without anyone having asked for them.
- The prompt forbids inventing, summarising or decorating — restructure only.
- `inspectKey()` catches the common mistake of pasting an OAuth token or an
  `AQ.…` token instead of an `AIza…` AI Studio key, and says so before making
  a request that would fail confusingly.
- 429 is retried with backoff, since the free tier rate-limits rather than
  failing.
- Every rewrite is undoable; the extracted text is kept — and "Rewrite again"
  goes back to that extracted text rather than rewriting the rewrite, which
  would compound whatever the first pass got wrong. Editing the Source tab by
  hand overrides that and sends what you typed.

## Reading modes

`src/core/pager.js` turns the article into a CSS multi-column box as tall as
the window, so text flows into column after column off to the right and a page
turn is a horizontal translate. Nothing about the DOM changes, which is why
highlights, find and the outline keep working — they just ask the pager which
page an element landed on.

Three flows, set in Appearance → Layout: `scroll`, `paged`, `book` (a two-page
spread, falling back to one page under 720px).

Two things about it are easy to get wrong:

- **The advance is the content width plus the gap**, not the element width.
  Columns are laid out in the content box, so including padding puts every
  page a little further out than the last.
- **`scrollWidth` on an overflowing multicol box is not dependable.** The page
  count comes from a zero-width probe appended to the end of the flow, which
  lands in the last column and can simply be measured.
- **The clipping has to happen on a frame, not on the scroller.** A page
  narrower than the viewport would otherwise show its neighbouring columns in
  the margins either side.

### Looking like a book, not like columns

The frame that does the clipping is also the physical sheet, and that split is
the whole trick: **the sheet translates, the frame does not**, so everything
that belongs to the book rather than to the text is painted on the frame.

- `.read-main` is the desk — the app background, with room around the block.
- `.page-frame` is the paper: background, rounded corners, drop shadow, and a
  `::after` that draws the cut edge of the block as fine ruled lines at the
  outer margin with the gutter shading where the paper turns into the binding.
- In `book`, `.page-frame::before` is the spine: a soft gutter shadow down the
  fold, symmetric, darkest at the centre.
- `.running-head` and `.folio` are absolutely positioned on the frame. One page
  centres the note's title under a hairline rule; a spread puts the note on the
  verso and the current section on the recto, the way a bound book does, and
  drops the rule because it would run through the spine. Page one stays bare.
  A spread's folio counts leaves, not turns: `index * cols + 1` and `+ 2`.
- `.page-turn-fx` sweeps a band of shadow across the block in the direction of
  travel. `pager.apply()` reports the direction; `reader.js` restarts the
  animation by removing the class, reading `offsetWidth`, and adding it back.
- `[data-dropcap="on"]` sets the note's first letter large. Off by default, on
  in the Book and Manuscript presets, with its own toggle in Appearance → Type.
- `#page-count` survives as a visually hidden `aria-live` region, so a turn is
  still announced; the folio does the seeing.
- The toolbar gives up its panel, its blur and its rule in these two flows, and
  the one saturated button loses its fill. A page lying on a desk with a solid
  toolbar over it reads as two surfaces; this way there is only the desk and
  the page.
- The turn is `calc(var(--t-mid) * 1.6)` on `cubic-bezier(.26,.86,.28,1)` —
  quick off the mark, long settle, the way a leaf falls. `[data-motion="off"]`
  collapses it through `--speed`, and `playTurn()` skips the shadow entirely.

## Reading styles

`settings.PRESETS` bundles theme, typeface, flow, callout treatment, justification
and indents into one tap: **Lucid** (the default), **Book** (warm stock, two
pages, indented justified paragraphs, callouts set as hairline rules and small
caps) and **Manuscript**. `data-callouts="quiet"` is what turns the coloured
panels into something a printed book would do.

## Polish list — all ten done ✅

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
7. ~~**Focus handling in overlays.**~~ Done — `trapFocus()` in `ui/ui.js`
   keeps Tab inside the sheet, palette, menu and lightbox, and hands focus
   back to the opener. Menus take arrow keys too.
8. ~~**Study stats.**~~ Done — due now / this week / total, a day streak, how
   many cards were reviewed today, and when the next one comes back. Subject
   chips carry a due badge.
9. ~~**Reader gestures.**~~ Done — swipe in from the left edge for the
   outline, from the right for the highlights, and swipe an open panel away.
   Touch only, and only when the panels float over the page.
10. ~~**Duplicate detection.**~~ Done — `store.findDuplicate()` compares the
    opening 400 characters of the prose and the overall length, so pasting or
    importing the same material twice offers to open the one you have. A half
    -length excerpt is not treated as a duplicate.

---

## What is left, if you want more

Nothing here is needed for the app to be good. Judgement calls, roughly in
order of what a person would notice.

1. **Highlight colour meanings.** Let the five colours be named ("definition",
   "exam", "don't understand") and show the names in the filter row. Cheap,
   and it turns the colours into a system rather than decoration.
2. **A note outline that shows highlights.** Dots in the outline where the
   highlights are, so the sidebar doubles as a revision map.
3. **Import a whole folder.** Multiple files already import in one go, but
   without a queue UI — it just makes a note per file and lands you in the
   library.
4. **PDF figure extraction.** Whole pages come in as images; pulling out the
   individual figures would be better, and needs `getOperatorList()`.
5. **A denser library row.** The list layout hides the excerpt; it could show
   the outline instead.
6. **Reduced-motion polish.** `prefers-reduced-motion` is honoured, but the
   panel slide-ins could cross-fade instead of sliding.
7. **An `::: audio` or `::: video` block** for embedded lecture clips, stored
   as blobs like the images.

### Known limits (deliberate, not bugs)

- Scanned PDFs are not OCR'd — the importer detects them and offers page
  images instead.
- `$…$` renders as styled monospace, not typeset maths. A real engine would
  mean shipping KaTeX, which is a large dependency for a small gain here.
- EMF/WMF images inside Office files are skipped; browsers cannot display
  them.
- Multi-file import creates a note per file without a preview step.
