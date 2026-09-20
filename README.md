<div align="center">

<img src="assets/icons/icon.svg" width="88" alt="">

# Lucid

**A quiet, beautiful home for the notes you actually have to learn.**

Paste a summary from Claude. Drop in the PDF your lecturer exported in 2009.
Read it on your iPad in type you chose yourself, highlight what matters, and
revise it later from flashcards it built for you.

No account. No server. Nothing leaves your device.

</div>

---

## What it does

**Reads beautifully.** Every note lands on the same page — the same measure, the
same rhythm, the same spacing. Nine themes, eight typefaces, and sliders for
text size, line height, line length, paragraph gap, first-line indent, letter
spacing, word spacing, heading weight and corner radius. Everything applies
live, and it remembers.

**Reads as pages, if you'd rather.** Scroll, one page at a time, or a two-page
spread like an open book — turn with the arrow keys, by clicking either edge,
or by swiping. The **Book** reading style goes further: warm paper stock, a
serif face, justified indented paragraphs, and callouts set the way a printed
book would set them, in hairline rules and small caps rather than glowing
panels.

**Understands how notes are structured.** On top of ordinary Markdown, Lucid
reads callouts (`::: key`, `::: warn`, `::: exam`, `::: definition`…), numbered
step sequences, two-column comparisons, definition lists, display formulas and
self-test blocks. They render as designed components rather than as walls of
text.

**Tells the AI what to write.** One button copies a prompt that teaches Claude
the format exactly. Paste it once at the start of a conversation and every
summary after it arrives already shaped — sections, callouts, a recap, and
questions to test yourself with.

**Highlights and annotates.** Select anything: five highlight colours, a note
attached to the passage, or a flashcard made on the spot. Highlights survive
editing — they re-find their text if it moves. A side panel lists them all,
filterable by colour, and jumps you back to where each one lives.

**Keeps a library, not a pile.** Subjects and tags that actually filter,
pinning, archiving, search that reads inside every note, and previous/next
cards so a set of lectures reads in order — with "Lecture 2" before
"Lecture 10", the way a person would sort them.

**Imports the ugly stuff.** Drop a PDF, PowerPoint or Word file. Lucid pulls the
text out, rejoins the lines the PDF broke mid-sentence, repairs hyphenated
words, throws away page numbers and running headers, normalises the bullets —
including the ones that decoded into some random glyph — works out which lines
were headings from their size and weight, notices two-column layouts, and turns
"Important:" and "Q:/A:" into real callouts and flashcards. Slides keep their
pictures and speaker notes. A page that is really a diagram comes in as an
image. Then you edit whatever it got wrong.

**Remembers what you've revised.** Every `::: quiz` question and every card you
make becomes a scheduled flashcard. Grade it Again / Hard / Good / Easy and it
comes back when you need it, not before. Study one note, one subject, or
everything that is due; the finished screen shows what is waiting, what is
coming this week, and how many days in a row you have kept it up.

**Built for a keyboard.** `⌘K` for everything, `⌘N` for a new note, `1`–`5` to
highlight the selection, `N` for a note, `C` for a card, `⌘F` to find, `[` and
`]` to move between notes, `F` for focus mode, `?` for the full list. Tab stays
inside whatever dialog is open and comes back to where it started. On a phone,
swipe in from either edge for the outline and the highlights.

**Works offline.** It is a static site with a service worker. Add it to your
Home Screen from Safari's Share menu and it opens like an app, on a plane, with
everything still in it.

---

## Running it

It is plain HTML, CSS and ES modules — no build step, no dependencies to
install.

```bash
# anything that serves static files works
python3 -m http.server 8000
# then open http://localhost:8000
```

Opening `index.html` straight off the disk mostly works, but browsers block ES
modules and IndexedDB on `file://`, so use a server.

### Putting it on the web

The repository ships a GitHub Actions workflow that runs the tests and
publishes the site to GitHub Pages on every push.

It is already running at **https://ali3401.github.io/Studying-App/**, and every
push redeploys it.

On your iPad: open that link, then Share → **Add to Home Screen**. Do the
second part — it is also what persuades Safari to stop clearing your notes to
reclaim space.

Setting this up on a fork takes two settings, because a workflow is not
allowed to switch Pages on for itself:

1. The repository must be **public** (GitHub Pages on a private repo needs a
   paid plan).
2. **Settings → Pages → Build and deployment → Source: GitHub Actions**

The workflow checks for this and says so plainly if it is missing.

Any static host works just as well — Netlify, Vercel, Cloudflare Pages, or a
folder on a web server. There is no backend to deploy.

---

## Writing notes

See **[PROMPT.md](PROMPT.md)** for the prompt to give Claude, and the full
syntax table. The same thing lives in the app under **AI Guide**.

The short version:

````markdown
---
title: The Cardiac Cycle
subject: Physiology
tags: heart, exam
emoji: 🫀
accent: crimson
---

## The four phases

Ordinary paragraphs, **bold**, *italics*, `code`, ==important==.

::: key The one thing to remember
Valves open and close because of pressure differences. Everything follows.
:::

::: steps A single beat
- Filling
- Isovolumetric contraction
- Ejection
- Isovolumetric relaxation
:::

::: compare Systole vs Diastole
- Ventricles contract
|||
- Ventricles relax and fill
:::

::: quiz
Q: Why does tachycardia reduce stroke volume?
A: It shortens diastole, so the ventricle has less time to fill.
:::
````

---

## Where your notes live

In this browser, on this device, in IndexedDB — notes, highlights, flashcard
schedules and images alike. Nothing is uploaded anywhere, and there is no
account to make.

Lucid asks the browser to treat that storage as persistent, which stops it
being cleared to reclaim space — Safari grants this once the app is on your
Home Screen, and the Data panel tells you whether it has.

Clearing Safari's website data by hand would still take your notes with it, so
**Appearance → Data → Export everything** writes a single JSON file with
everything inside it. Keep one in iCloud Drive; Lucid offers a one-tap export
if a fortnight goes by without one. Restoring it puts everything back, on any
device.

---

## How it is put together

```
index.html            the shell: every view lives here, hidden until routed to
styles/               tokens.css holds every design variable the app can retune
  tokens.css            themes, accents, type presets, spacing, motion
  reader.css            the page itself — prose, callouts, highlights
src/
  core/               settings, storage, routing, highlighting, the AI prompt
  parse/              Lucid Markdown → AST → HTML
  import/             PDF, PowerPoint, Word, and the clean-up engine
  views/              library, reader, editor, study, import, guide
  ui/                 toasts, sheets, menus, command palette, export
vendor/               pdf.js and JSZip, vendored so the app works offline
tools/selftest.mjs    run it with `node tools/selftest.mjs`
```

Highlights anchor to `(block id, start offset, end offset)` and also store the
text they cover, so when a note is edited they re-find themselves rather than
drifting onto the wrong words.

Run the tests with:

```bash
node tools/selftest.mjs     # 107 assertions, no browser needed
```

It covers the parser, the renderer, the clean-up engine, note fingerprinting
and the streak arithmetic. The modules it imports are guarded so they load
outside a browser — worth keeping that way.

---

## Licence

MIT. See [LICENSE](LICENSE).

pdf.js (Apache 2.0) and JSZip (MIT) are vendored in `vendor/` with their
licence texts.
