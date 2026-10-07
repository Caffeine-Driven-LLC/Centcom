/** Walks contracts/fixtures/<area>/**. A folder that is missing gives an empty area, which the runner reports as skipped, never as a pass. */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { Fixture, FixtureSet } from './types.js';

const walk = (d: string): string[] => readdirSync(d).sort().flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : p.endsWith('.json') ? [p] : []; });
export function loadFixtures(contractsDir: string): FixtureSet {
  const root = join(contractsDir, 'fixtures'); const all: Fixture[] = [];
  if (existsSync(root)) for (const p of walk(root)) { const rel = relative(root, p); all.push({ area: rel.split(sep)[0]!, file: rel.split(sep).join('/'), json: JSON.parse(readFileSync(p, 'utf8')) }); }
  return { all, area: (name) => all.filter((f) => f.area === name) };
}
export function loadSchemas(contractsDir: string): Record<string, unknown> {
  const dir = join(contractsDir, 'schemas'); const out: Record<string, unknown> = {}; if (!existsSync(dir)) return out;
  for (const n of readdirSync(dir)) if (n.endsWith('.json')) out[n] = JSON.parse(readFileSync(join(dir, n), 'utf8')); return out;
}
