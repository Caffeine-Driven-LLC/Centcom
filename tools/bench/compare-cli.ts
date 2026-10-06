/** `pnpm bench:compare <a.json> <b.json>`: a table of the second run against the first (used in PR comments). */
import { readFileSync } from 'node:fs';
import { table, type BenchResults } from './compare.js';

const [x, y] = process.argv.slice(2); if (!x || !y) { console.error('Usage: pnpm bench:compare <before.json> <after.json>'); process.exit(2); }
const load = (p: string) => JSON.parse(readFileSync(p, 'utf8')) as BenchResults;
for (const l of table(load(y), load(x))) console.log(l);
