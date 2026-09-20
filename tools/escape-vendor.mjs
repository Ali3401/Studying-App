/* ==========================================================================
   Lucid — prepare vendor files for hosts that reject raw control bytes.

   pdf.js's minified worker embeds raw control characters (ESC, SOH, STX…)
   inside string literals, where they build binary font tables. Some hosts
   refuse to serve a text file containing them. Replacing each with its \xNN
   escape is byte-for-byte equivalent once the JS engine parses the string,
   and leaves the vendored original in the repo untouched so it can still be
   checked against what npm ships.

   Usage: node tools/escape-vendor.mjs <outputDir>
   ========================================================================== */

import fs from 'node:fs';
import path from 'node:path';

const KEEP = new Set([0x09, 0x0a, 0x0d]);   // tab, newline, carriage return
const outDir = process.argv[2];
if (!outDir) {
  console.error('usage: node tools/escape-vendor.mjs <outputDir>');
  process.exit(1);
}

const targets = ['vendor/pdf.worker.min.mjs', 'vendor/pdf.min.mjs', 'vendor/jszip.min.js'];
let total = 0;

for (const rel of targets) {
  const text = fs.readFileSync(rel, 'utf8');
  let changed = 0;
  const escaped = Array.from(text, (ch) => {
    const code = ch.codePointAt(0);
    if ((code < 0x20 && !KEEP.has(code)) || code === 0x7f) {
      changed++;
      return '\\x' + code.toString(16).padStart(2, '0');
    }
    return ch;
  }).join('');

  const dest = path.join(outDir, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, escaped);
  total += changed;
  console.log(`${rel}: ${changed} control character${changed === 1 ? '' : 's'} escaped`);
}

console.log(`${total} in total`);
