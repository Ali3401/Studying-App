/* Lucid — appearance & behaviour settings, stored in localStorage and
   applied as data-attributes + CSS custom properties on <html>. */

const KEY = 'lucid.settings.v1';

export const THEMES = [
  { id: 'midnight', name: 'Midnight', dark: true,  bg: '#0e1117', ink: '#e8edf5', line: '#262e3b' },
  { id: 'ink',      name: 'Ink',      dark: true,  bg: '#000000', ink: '#edf1f7', line: '#1e222a' },
  { id: 'slate',    name: 'Slate',    dark: true,  bg: '#16181d', ink: '#eceef2', line: '#31363f' },
  { id: 'nord',     name: 'Nord',     dark: true,  bg: '#2e3440', ink: '#eceff4', line: '#4a5467' },
  { id: 'forest',   name: 'Forest',   dark: true,  bg: '#0f1613', ink: '#e7f0ea', line: '#27352d' },
  { id: 'paper',    name: 'Paper',    dark: false, bg: '#f4f5f7', ink: '#171a20', line: '#e0e4ea' },
  { id: 'sepia',    name: 'Sepia',    dark: false, bg: '#efe7d8', ink: '#2f2a22', line: '#ddd2bb' },
  { id: 'book',     name: 'Book',     dark: false, bg: '#d9d2c5', ink: '#241f1a', line: '#ded5c5' },
  { id: 'contrast', name: 'Contrast', dark: true,  bg: '#000000', ink: '#ffffff', line: '#4a4a4a' },
];

/** One tap to change how the whole thing reads, not just its colours. */
export const PRESETS = [
  {
    id: 'lucid', name: 'Lucid', hint: 'The default — a calm screen, one continuous page.',
    values: { theme: 'midnight', font: 'editorial', flow: 'scroll', callouts: 'panel',
      align: 'left', hyphens: false, paraIndent: 0, paraSpace: 1.15, headings: 'plain',
      texture: 'plain', paper: 'flat', measure: 68, lineHeight: 1.7, accent: 'blue' },
  },
  {
    id: 'book', name: 'Book', hint: 'A printed page: warm stock, two pages open, indented paragraphs.',
    values: { theme: 'book', font: 'classic', flow: 'book', callouts: 'quiet',
      align: 'justify', hyphens: true, paraIndent: 1.3, paraSpace: 0.15, headings: 'plain',
      texture: 'plain', paper: 'flat', measure: 64, lineHeight: 1.62, accent: 'crimson' },
  },
  {
    id: 'paper', name: 'Manuscript', hint: 'Daylight, one page at a time, plenty of air.',
    values: { theme: 'paper', font: 'book', flow: 'paged', callouts: 'quiet',
      align: 'left', hyphens: false, paraIndent: 0, paraSpace: 1.2, headings: 'rule',
      texture: 'plain', paper: 'flat', measure: 66, lineHeight: 1.75, accent: 'slate' },
  },
];

export const ACCENTS = [
  { id: 'blue',    name: 'Blue',    c: 'hsl(214 92% 60%)' },
  { id: 'indigo',  name: 'Indigo',  c: 'hsl(248 84% 66%)' },
  { id: 'violet',  name: 'Violet',  c: 'hsl(272 80% 68%)' },
  { id: 'magenta', name: 'Magenta', c: 'hsl(318 76% 64%)' },
  { id: 'crimson', name: 'Crimson', c: 'hsl(349 80% 62%)' },
  { id: 'amber',   name: 'Amber',   c: 'hsl(38 92% 56%)' },
  { id: 'gold',    name: 'Gold',    c: 'hsl(45 84% 55%)' },
  { id: 'emerald', name: 'Emerald', c: 'hsl(158 72% 46%)' },
  { id: 'teal',    name: 'Teal',    c: 'hsl(180 68% 45%)' },
  { id: 'cyan',    name: 'Cyan',    c: 'hsl(195 86% 52%)' },
  { id: 'slate',   name: 'Graphite',c: 'hsl(215 18% 62%)' },
];

export const FONTS = [
  { id: 'modern',    name: 'Modern',    sample: 'Ag' },
  { id: 'editorial', name: 'Editorial', sample: 'Ag' },
  { id: 'classic',   name: 'Classic',   sample: 'Ag' },
  { id: 'book',      name: 'Book',      sample: 'Ag' },
  { id: 'humanist',  name: 'Humanist',  sample: 'Ag' },
  { id: 'grotesk',   name: 'Grotesk',   sample: 'Ag' },
  { id: 'readable',  name: 'Readable',  sample: 'Ag' },
  { id: 'mono',      name: 'Mono',      sample: 'Ag' },
];

export const HL_COLORS = [
  { id: 1, h: 48,  name: 'Butter' },
  { id: 2, h: 145, name: 'Mint' },
  { id: 3, h: 200, name: 'Sky' },
  { id: 4, h: 330, name: 'Rose' },
  { id: 5, h: 268, name: 'Lilac' },
];

export const DEFAULTS = {
  theme: 'midnight',
  autoTheme: false,
  lightTheme: 'paper',
  darkTheme: 'midnight',
  accent: 'blue',
  font: 'editorial',
  uiFont: 'modern',
  fontScale: 1,
  lineHeight: 1.7,
  measure: 68,
  paraSpace: 1.15,
  paraIndent: 0,
  letterSpace: 0,
  wordSpace: 0,
  align: 'left',
  hyphens: false,
  headings: 'plain',
  headingWeight: 680,
  radius: 14,
  density: 1,
  shadow: 1,
  texture: 'plain',
  paper: 'flat',
  motion: 'on',
  hlStyle: 'solid',
  hlAlpha: 0.30,
  images: 'shown',
  spotlight: 'off',
  flow: 'scroll',        // scroll | paged | book
  callouts: 'panel',     // panel | quiet
  libLayout: 'grid',
  libSort: 'updated',
  showOutline: true,
  showNotes: false,
  edLayout: 'split',
  edSplit: 1,
  lastSubject: '',
  seenWelcome: false,
  lastExport: 0,
  lastBackupNudge: 0,
  persisted: null,
  studyDays: [],      // ISO dates, most recent last
  reviewCounts: {},   // ISO date -> cards graded
};

let current = { ...DEFAULTS };
const listeners = new Set();

export function load() {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(KEY);
    if (raw) current = { ...DEFAULTS, ...JSON.parse(raw) };
  } catch { /* keep defaults */ }
  return current;
}

export function get(key) { return key ? current[key] : current; }
export const all = () => ({ ...current });

export function set(patch, silent = false) {
  Object.assign(current, patch);
  try { localStorage.setItem(KEY, JSON.stringify(current)); } catch {}
  apply();
  if (!silent) listeners.forEach(fn => fn(current, patch));
  return current;
}

export function reset() {
  current = { ...DEFAULTS, seenWelcome: current.seenWelcome };
  try { localStorage.setItem(KEY, JSON.stringify(current)); } catch {}
  apply();
  listeners.forEach(fn => fn(current, current));
}

export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

const mql = (typeof window !== 'undefined' && window.matchMedia)
  ? window.matchMedia('(prefers-color-scheme: dark)')
  : { matches: false, addEventListener() {} };

export function resolvedTheme() {
  if (current.autoTheme) return mql.matches ? current.darkTheme : current.lightTheme;
  return current.theme;
}

export function apply() {
  if (typeof document === 'undefined') return;
  const r = document.documentElement;
  const s = current;
  const theme = resolvedTheme();
  r.dataset.theme = theme;
  r.dataset.accent = s.accent;
  r.dataset.font = s.font;
  r.dataset.headings = s.headings;
  r.dataset.texture = s.texture;
  r.dataset.paper = s.paper;
  r.dataset.motion = s.motion;
  r.dataset.hlstyle = s.hlStyle;
  r.dataset.images = s.images;
  r.dataset.spotlight = s.spotlight;
  r.dataset.flow = s.flow;
  r.dataset.callouts = s.callouts;

  const st = r.style;
  st.setProperty('--font-scale', s.fontScale);
  st.setProperty('--line-height', s.lineHeight);
  st.setProperty('--measure', s.measure + 'ch');
  st.setProperty('--para-space', s.paraSpace + 'em');
  st.setProperty('--para-indent', s.paraIndent + 'em');
  st.setProperty('--letter-space', s.letterSpace + 'em');
  st.setProperty('--word-space', s.wordSpace + 'em');
  st.setProperty('--text-align', s.align);
  st.setProperty('--hyphens', s.hyphens ? 'auto' : 'manual');
  st.setProperty('--heading-weight', s.headingWeight);
  st.setProperty('--radius', s.radius + 'px');
  st.setProperty('--radius-sm', Math.max(4, Math.round(s.radius * 0.64)) + 'px');
  st.setProperty('--radius-lg', Math.round(s.radius * 1.42) + 'px');
  st.setProperty('--density', s.density);
  st.setProperty('--shadow-strength', s.shadow);
  st.setProperty('--hl-alpha', s.hlAlpha);
  st.setProperty('--ed-split', s.edSplit + 'fr');

  const t = THEMES.find(t => t.id === theme);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta && t) meta.setAttribute('content', t.bg);
}

mql.addEventListener?.('change', () => { if (current.autoTheme) { apply(); listeners.forEach(fn => fn(current, {})); } });

export function exportSettings() { return { ...current }; }
export function importSettings(obj) { set({ ...DEFAULTS, ...obj }); }
