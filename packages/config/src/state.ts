/** Small pieces of state the client keeps between runs, separate from settings: prompt history per project. */
import { join } from 'node:path';
import type { LoadDeps } from './load.js';
import { stateDir } from './load.js';

const MAX_PER_PROJECT = 200, MAX_PROJECTS = 50, MAX_LEN = 20_000;
type Store = Record<string, { at: number; items: string[] }>;
const file = (d: Pick<LoadDeps, 'env' | 'homedir'>) => join(stateDir(d), 'history.json');
function read(d: Pick<LoadDeps, 'env' | 'homedir' | 'fs'>): Store { try { const t = d.fs.read(file(d)); const j = t ? JSON.parse(t) : {}; return j && typeof j === 'object' ? j : {}; } catch { return {}; } }

export function loadHistory(d: Pick<LoadDeps, 'env' | 'homedir' | 'fs'>, cwd: string): string[] { return read(d)[cwd]?.items.filter((x) => typeof x === 'string') ?? []; }

export function saveHistory(d: Pick<LoadDeps, 'env' | 'homedir' | 'fs'>, cwd: string, items: string[]): void {
  const s = read(d); s[cwd] = { at: Date.now(), items: items.filter((x) => x && x.length <= MAX_LEN).slice(-MAX_PER_PROJECT) };
  const keep = Object.entries(s).sort((a, b) => b[1].at - a[1].at).slice(0, MAX_PROJECTS);
  d.fs.writeAtomic(file(d), JSON.stringify(Object.fromEntries(keep)), 0o600);
}
