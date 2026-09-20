/* ==========================================================================
   Lucid — drive the app as a phone, not photograph one.

   A 390px screenshot can look perfect while the app is unusable, because the
   things that break under a finger are invisible in a still: an overlay that
   sits on top of the text, a control that flex has squeezed to 18px, a bar
   that overflows off the right edge. Every one of those shipped once.

   So this checks the three things a picture cannot:

     1. HIT TEST   — is the reading column actually reachable, or is some
                     invisible overlay taking the taps?
     2. TAP SIZE   — is every control at least 44px, the size Apple asks for?
                     Controls that are small on purpose may instead grow a
                     hit area with a pseudo-element; those are probed rather
                     than measured.
     3. OVERFLOW   — does any toolbar or view run off the side of the screen?

   Usage: serve the folder, then
     node tools/phone-audit.mjs [http://127.0.0.1:8777]
   It needs Playwright and exits non-zero if anything fails.
   ========================================================================== */

/* The repo has no dependencies and no build step, so Playwright is wherever
   you installed it. Set PLAYWRIGHT_PATH if it is not resolvable by name. */
const { chromium } = await (async () => {
  for (const spec of [process.env.PLAYWRIGHT_PATH, 'playwright', 'playwright-core'].filter(Boolean)) {
    try { return await import(spec); } catch { /* try the next one */ }
  }
  console.error('Could not find Playwright. Install it, or set PLAYWRIGHT_PATH to its index.mjs.');
  process.exit(2);
})();

const BASE = process.argv[2] || 'http://127.0.0.1:8777';
const MIN_TAP = 44;

/* Controls whose drawn box is deliberately smaller than a fingertip. They
   are exempt from the measurement and probed for a hit area instead. */
const HIT_AREA_ONLY = ['.tag-btn', '.chip-tag', '.accent-dot'];

/* Knowingly under 44px. `.btn-xs` is the ✕ in a panel header, and that panel
   also closes by tapping the scrim and by swiping it away — so a small target
   there costs nothing. Add to this list only with a reason like that one. */
const ALLOWED_SMALL = ['.btn-xs'];

const DEVICES = [
  { name: 'iphone',        viewport: { width: 390, height: 844 },  touch: true },
  { name: 'iphone-land',   viewport: { width: 844, height: 390 },  touch: true },
  { name: 'ipad-portrait', viewport: { width: 1024, height: 1366 }, touch: true },
  { name: 'desktop',       viewport: { width: 1440, height: 900 },  touch: false },
];

let failures = 0;
const fail = (device, where, msg) => { failures++; console.log(`  ✗ [${device}] ${where}: ${msg}`); };

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--no-sandbox'],
});

for (const dev of DEVICES) {
  const ctx = await browser.newContext({
    viewport: dev.viewport, deviceScaleFactor: 2,
    isMobile: dev.touch, hasTouch: dev.touch,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await page.goto(`${BASE}/index.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);

  const id = await page.evaluate(async () => {
    const store = await import('/src/core/store.js');
    const { SAMPLE } = await import('/src/core/sample.js');
    const d = await store.create({ title: 'The Cardiac Cycle', subject: 'Physiology', emoji: '🫀', markdown: SAMPLE });
    return d.id;
  });

  /* ---- 1. nothing invisible may sit on the reading column ---- */
  for (const flow of ['paged', 'book']) {
    await page.evaluate(async ([docId, f]) => {
      const s = await import('/src/core/settings.js');
      s.set({ flow: f });
      location.hash = '#/reader?id=' + docId;
    }, [id, flow]);
    await page.waitForTimeout(1200);

    const blocked = await page.evaluate(() => {
      const bad = [];
      const xs = [0.06, 0.2, 0.5, 0.8, 0.94].map((f) => Math.round(innerWidth * f));
      const ys = [0.25, 0.45, 0.65].map((f) => Math.round(innerHeight * f));
      for (const y of ys) {
        for (const x of xs) {
          const el = document.elementFromPoint(x, y);
          if (el && el.closest('.turner')) bad.push(`${x},${y}`);
        }
      }
      return bad;
    });
    if (blocked.length && dev.touch) {
      fail(dev.name, `reader ${flow}`, `page-turn overlay covers the text at ${blocked.join(' ')} — text cannot be selected there`);
    }
  }

  /* ---- 2. every control is reachable, and big enough ---- */
  const views = [
    ['library', () => { location.hash = '#/library'; }],
    ['reader',  (d) => { location.hash = '#/reader?id=' + d; }],
    ['editor',  (d) => { location.hash = '#/editor?id=' + d; }],
    ['import',  () => { location.hash = '#/import'; }],
    ['study',   (d) => { location.hash = '#/study?id=' + d; }],
  ];

  for (const [view, goTo] of views) {
    await page.evaluate(goTo, id);
    await page.waitForTimeout(1100);

    const report = await page.evaluate(([min, exempt, allowed]) => {
      const seen = (el) => {
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.top < innerHeight && r.bottom > 0 && r.left < innerWidth && r.right > 0;
      };
      const name = (el) => `${el.tagName.toLowerCase()}.${(el.className || '').toString().trim().split(/\s+/)[0]}${el.dataset.act ? `[${el.dataset.act}]` : ''}`;

      const small = [], reach = [], spill = [];
      for (const el of document.querySelectorAll('button, a[href], input, select, textarea, [role="button"]')) {
        if (!seen(el)) continue;
        const r = el.getBoundingClientRect();
        if (allowed.some((sel) => el.matches(sel))) continue;
        const exemptHere = exempt.some((sel) => el.matches(sel));

        if (exemptHere) {
          // small on purpose: the hit area must still reach a fingertip
          const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
          const probe = document.elementFromPoint(cx, Math.min(innerHeight - 1, cy + 14));
          if (!probe || !(probe === el || el.contains(probe) || probe.closest(exempt.join(',')))) {
            reach.push(`${name(el)} has no extended hit area`);
          }
          continue;
        }
        // a short control inside a tall tappable parent is fine
        const parent = el.parentElement;
        const ph = parent ? parent.getBoundingClientRect().height : 0;
        const effective = Math.max(r.height, el.matches('input, select, textarea') ? ph : 0);
        if (r.width < min || effective < min) small.push(`${name(el)} ${Math.round(r.width)}x${Math.round(r.height)}`);
      }

      for (const bar of document.querySelectorAll('.doc-bar, .lib-head-top, .ed-meta, .flash-grades')) {
        if (!seen(bar)) continue;
        if (bar.scrollWidth > bar.clientWidth + 1) spill.push(`${name(bar)} ${bar.scrollWidth}>${bar.clientWidth}`);
      }

      return {
        small: [...new Set(small)], reach: [...new Set(reach)], spill: [...new Set(spill)],
        hScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      };
    }, [MIN_TAP, HIT_AREA_ONLY, ALLOWED_SMALL]);

    if (report.hScroll) fail(dev.name, view, 'the page scrolls sideways');
    for (const s of report.spill) fail(dev.name, view, `overflows its bar: ${s}`);
    if (dev.touch) for (const s of report.reach) fail(dev.name, view, s);
    if (dev.touch) for (const s of report.small) fail(dev.name, view, `below ${MIN_TAP}px: ${s}`);
  }

  for (const e of errors) fail(dev.name, 'runtime', e);
  console.log(`${dev.name} checked`);
  await ctx.close();
}

await browser.close();
console.log(failures ? `\n✗ ${failures} problem(s)` : '\n✓ no problems');
process.exit(failures ? 1 : 0);
