/* Lucid — self test. Runs the pure logic (parser, renderer, clean-up) in node.
   `node tools/selftest.mjs` */

import { parse, inline, plain, quizItems, splitFrontmatter, buildFrontmatter } from '../src/parse/lmd.js';
import { render, textOf, excerpt } from '../src/parse/render.js';
import { tidy, typography, unwrap, repairHyphens, normaliseBullets, detectQuiz, detectCallouts, guessTitle, guessSubject } from '../src/import/tidy.js';
import { SAMPLE, WELCOME } from '../src/core/sample.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; }
  else { fail++; console.error(`  ✗ ${name}${extra ? '\n    ' + extra : ''}`); }
};
const group = (n) => console.log(`\n${n}`);
const html = (md) => render(parse(md).blocks, {}).html;

/* ---------- front matter ---------- */
group('front matter');
{
  const { meta, body } = splitFrontmatter('---\ntitle: A\nsubject: B\ntags: x, y\n---\n\nHello');
  ok('title', meta.title === 'A');
  ok('tags split', Array.isArray(meta.tags) && meta.tags.length === 2);
  ok('body kept', body.trim() === 'Hello');
  ok('round trip', splitFrontmatter(buildFrontmatter(meta) + body).meta.title === 'A');
  ok('no front matter is fine', splitFrontmatter('# Hi').body === '# Hi');
  ok('a divider is not front matter', splitFrontmatter('text\n\n---\n\nmore').meta.title === undefined);
}

/* ---------- blocks ---------- */
group('block parsing');
{
  const b = parse('## Head\n\ntext\n\n- a\n- b\n\n1. one\n2. two\n\n> quote\n\n---\n\n```js\ncode\n```').blocks;
  const types = b.map(x => x.t).join(',');
  ok('all block types', types === 'h,p,list,list,quote,hr,code', types);
  ok('ordered detected', b[3].ordered === true);
  ok('list items', b[2].items.length === 2);
  ok('code language', b[6].lang === 'js');
}
{
  const b = parse('- top\n  - nested one\n  - nested two\n- second').blocks[0];
  ok('nesting', b.items[0].children?.[0]?.items?.length === 2, JSON.stringify(b.items[0].children));
  ok('sibling after nesting', b.items.length === 2);
}
{
  const b = parse('- [ ] todo\n- [x] done').blocks[0];
  ok('tasks', b.items[0].checked === false && b.items[1].checked === true);
}
{
  const b = parse('| a | b |\n| --- | ---: |\n| 1 | 2 |').blocks[0];
  ok('table head', b.head.join() === 'a,b');
  ok('table rows', b.rows.length === 1);
  ok('table align', b.align[1] === 'right');
}
{
  const b = parse('Preload :: the stretch\nAfterload :: the resistance').blocks[0];
  ok('definition list', b.t === 'deflist' && b.items.length === 2);
}

/* ---------- containers ---------- */
group('containers');
{
  const b = parse('::: key Title\nbody text\n:::').blocks[0];
  ok('callout type', b.t === 'callout' && b.type === 'key');
  ok('callout title', b.title === 'Title');
  ok('callout body', b.blocks[0].text === 'body text');
}
ok('alias maps to a real type', parse('::: important\nx\n:::').blocks[0].type === 'key');
ok('unknown type falls back to note', parse('::: wibble\nx\n:::').blocks[0].type === 'note');
{
  const b = parse('::: steps How\n- first\n- second\n:::').blocks[0];
  ok('steps', b.t === 'steps' && b.items.length === 2, JSON.stringify(b.items));
}
{
  const b = parse('::: compare A vs B\n- left\n|||\n- right\n:::').blocks[0];
  ok('compare split', b.t === 'compare' && b.left.title === 'A' && b.right.title === 'B');
  ok('compare content', b.left.blocks[0].items[0].text === 'left');
}
{
  const b = parse('::: quiz\nQ: one?\nA: yes\n\nQ: two?\nA: no\n:::').blocks[0];
  ok('quiz pairs', b.t === 'quiz' && b.items.length === 2, JSON.stringify(b.items));
  ok('quiz answer', b.items[1].a === 'no');
}
ok('bare Q/A becomes a quiz', parse('Q: what?\nA: this').blocks[0].t === 'quiz');
{
  const b = parse('$$\nCO = HR x SV\n$$').blocks[0];
  ok('display maths', b.t === 'callout' && b.type === 'formula' && b.blocks[0].t === 'math');
}
{
  const b = parse('::: note Outer\nbefore\n\n::: tip\ninner\n:::\n\nafter\n:::').blocks;
  ok('nested containers', b.length === 1 && b[0].blocks.some(x => x.t === 'callout' && x.type === 'tip'),
     JSON.stringify(b.map(x => x.t)));
}

/* ---------- inline ---------- */
group('inline');
ok('bold', inline('**x**') === '<strong>x</strong>');
ok('italic', inline('an *x* here').includes('<em>x</em>'));
ok('code', inline('`a<b>`') === '<code>a&lt;b&gt;</code>');
ok('mark', inline('==x==').includes('<mark'));
ok('strike', inline('~~x~~') === '<del>x</del>');
ok('link', inline('[t](https://a.com)').includes('href="https://a.com"'));
ok('link opens in a new tab', inline('[t](https://a.com)').includes('target="_blank"'));
ok('javascript: url is neutralised', inline('[t](javascript:alert(1))').includes('href="#"'));
ok('html is escaped', inline('<script>x</script>').startsWith('&lt;script&gt;'));
ok('no formatting inside code', inline('`**x**`') === '<code>**x**</code>');
ok('escaped star stays literal', !inline('\\*not italic\\*').includes('<em>'));
ok('maths span', inline('$x^2$').includes('class="math"'));
ok('bare url linkified', inline('see https://a.com now').includes('<a href="https://a.com"'));
ok('plain strips markup', plain('**a** `b` [c](d)') === 'a b c');

/* ---------- rendering ---------- */
group('rendering');
{
  const r = render(parse('## One\n\ntext\n\n### Two').blocks, {});
  ok('outline built', r.outline.length === 2 && r.outline[0].level === 2);
  ok('heading ids unique', r.outline[0].id !== r.outline[1].id);
  ok('block ids stamped', /data-bid="b0"/.test(r.html) && /data-bid="b2"/.test(r.html));
}
{
  const dup = render(parse('## Same\n\n## Same').blocks, {});
  ok('duplicate headings get distinct ids', dup.outline[0].id !== dup.outline[1].id);
}
ok('image resolver used', render(parse('![c](img:abc)').blocks, { img: () => 'RESOLVED' }).html.includes('RESOLVED'));
ok('every callout renders', (html(SAMPLE).match(/class="callout"/g) || []).length >= 6);
ok('quiz renders', (html(SAMPLE).match(/class="quiz"/g) || []).length === 6);
ok('sample text extracted', textOf(parse(SAMPLE).blocks).includes('Frank–Starling'));
ok('excerpt is short', excerpt(parse(SAMPLE).blocks).length <= 230);
ok('sample quiz items', quizItems(parse(SAMPLE).blocks).length === 6);
ok('welcome note parses', parse(WELCOME).blocks.length > 5);

/* ---------- clean-up ---------- */
group('clean-up');
ok('hyphen repaired', repairHyphens('hydro-\nstatic').includes('hydrostatic'));
ok('bullets normalised', normaliseBullets('• one\n● two').split('\n').every(l => l.startsWith('- ')));
ok('odd glyph bullets detected',
   normaliseBullets('” a\n” b\n” c').split('\n').every(l => l.startsWith('- ')));
ok('a quote in prose is left alone', !normaliseBullets('He said ” once.').startsWith('- '));
{
  const t = unwrap('This sentence was hard wrapped by the exporter and keeps\ngoing onto a second line.\n\nNew paragraph.');
  ok('lines rejoined', t.split('\n')[0].includes('keeps going'), JSON.stringify(t));
  ok('paragraph break kept', t.includes('\n\nNew paragraph.'));
}
ok('structure survives typography', typography('::: key\nx\n:::').includes('::: key'));
ok('image ref survives typography', typography('![a](IMG:0)').includes('(IMG:0)'));
ok('quotes curled', typography('say "hi"').includes('“'));
ok('apostrophe curled', typography("it's") === 'it’s');
ok('ellipsis', typography('wait...') === 'wait…');
ok('callout detected', detectCallouts('Important: this matters').startsWith('::: key'));
ok('callout body capitalised', detectCallouts('Note: lower case').includes('Lower case'));
ok('quiz wrapped', detectQuiz('Q: a?\nA: b').startsWith('::: quiz'));
ok('page numbers stripped', !tidy('text\n\n12\n\nmore').includes('\n12\n'));
ok('title guessed', guessTitle('Renal Physiology\n\nbody text here') === 'Renal Physiology');
ok('subject guessed from filename', guessSubject('PHYS-201 lecture 4.pdf') === 'PHYS 201');
{
  const round = tidy(SAMPLE.replace(/^---[\s\S]*?---\n/, ''));
  ok('tidy keeps containers intact', (round.match(/^:::/gm) || []).length === (SAMPLE.match(/^:::/gm) || []).length,
     `${(round.match(/^:::/gm) || []).length} vs ${(SAMPLE.match(/^:::/gm) || []).length}`);
  ok('tidy keeps the table', round.includes('| Measure |'));
  ok('tidy output still parses to the same block count',
     parse(round).blocks.length === parse(SAMPLE).blocks.length,
     `${parse(round).blocks.length} vs ${parse(SAMPLE).blocks.length}`);
}

/* ---------- report ---------- */
console.log(`\n${fail ? '✗' : '✓'} ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
