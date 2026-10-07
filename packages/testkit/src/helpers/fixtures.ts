/** Reads a fixture from `contracts/fixtures` (path relative to that folder), found by walking up from the current folder. */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
function contractsDir(from = process.cwd()): string { let d = resolve(from); for (;;) { if (existsSync(join(d, 'contracts', 'fixtures'))) return join(d, 'contracts', 'fixtures'); const up = dirname(d); if (up === d) throw new Error('contracts/fixtures was not found above ' + from); d = up; } }
export function loadContractFixture<T = unknown>(path: string): T {
  if (path.split(/[\\/]/).includes('..') || path.startsWith('/')) throw new Error('fixture paths are relative to contracts/fixtures and cannot leave it');
  return JSON.parse(readFileSync(join(contractsDir(), path), 'utf8')) as T;
}
