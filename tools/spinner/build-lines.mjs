#!/usr/bin/env node
/* Builds packages/tui/src/spinner/lines.json from assets/The-Lines.txt: trimmed, no blanks, no repeats, order kept.
   `--check` fails when the committed file is out of date. The runtime never reads assets/. */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
export function buildLines(text) { const seen = new Set(); const out = []; for (const l of text.split('\n')) { const t = l.trim(); if (t && !seen.has(t)) { seen.add(t); out.push(t); } } return out; }
const src = root + 'assets/The-Lines.txt'; const dst = root + 'packages/tui/src/spinner/lines.json';
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const json = JSON.stringify(buildLines(readFileSync(src, 'utf8')), null, 1) + '\n';
  if (process.argv.includes('--check')) { let cur = ''; try { cur = readFileSync(dst, 'utf8'); } catch { /* missing */ } if (cur !== json) { console.error('lines.json is out of date: run node tools/spinner/build-lines.mjs'); process.exit(1); } console.log('lines.json up to date'); }
  else { writeFileSync(dst, json); console.log(`wrote ${JSON.parse(json).length} lines`); }
}
