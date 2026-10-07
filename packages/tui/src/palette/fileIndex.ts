/** Files of the project for the palette: `git ls-files`, else a walk that skips the usual folders; built in slices so input never waits. */
import { execFile } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fuzzyScore } from './fuzzy.js';
import type { PaletteItem } from './engine.js';

const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.cache', 'coverage', '.venv', '__pycache__', 'target']);
export interface FileIndex { search(q: string, signal: AbortSignal): Promise<PaletteItem[]>; ready(): Promise<void>; size(): number }
export function createFileIndex(d: { cwd: string; limit?: number; list?: () => Promise<string[]>; onPick?: (path: string) => void }): FileIndex {
  const limit = d.limit ?? 20_000; let files: string[] | undefined; let building: Promise<void> | undefined;
  const gitList = () => new Promise<string[]>((res, rej) => execFile('git', ['ls-files', '-co', '--exclude-standard'], { cwd: d.cwd, maxBuffer: 64 * 1024 * 1024 }, (e, out) => (e ? rej(e) : res(out.split('\n').filter(Boolean)))));
  async function walk(): Promise<string[]> { const out: string[] = []; const stack = ['']; while (stack.length && out.length < limit) { const rel = stack.pop()!; let ents; try { ents = await readdir(join(d.cwd, rel), { withFileTypes: true }); } catch { continue; } for (const e of ents) { if (SKIP.has(e.name) || (e.name.startsWith('.') && e.isDirectory())) continue; const p = rel ? `${rel}/${e.name}` : e.name; if (e.isDirectory()) stack.push(p); else out.push(p); } await new Promise((r) => setImmediate(r)); } return out; }
  const build = () => (building ??= (async () => { let l: string[]; try { l = await (d.list ?? gitList)(); } catch { l = await walk(); } files = l.slice(0, limit); })());
  return {
    ready: build, size: () => files?.length ?? 0,
    async search(q, signal) {
      await build(); if (signal.aborted || !files) return [];
      const top: { p: string; score: number; indices: number[] }[] = [];
      /* scored in slices of 2,000 so a 20,000 file project never blocks for long */
      for (let i = 0; i < files.length; i += 2000) { for (const p of files.slice(i, i + 2000)) { const base = p.slice(p.lastIndexOf('/') + 1); const f = fuzzyScore(q, p); if (!f) continue; const b = fuzzyScore(q, base); const score = f.score + (b ? 10 + b.score : 0); top.push({ p, score, indices: f.indices }); } top.sort((a, b) => b.score - a.score); top.length = Math.min(top.length, 20); if (signal.aborted) return []; if (i + 2000 < files.length) await new Promise((r) => setImmediate(r)); }
      return top.slice(0, 20).map((t): PaletteItem => ({ id: `file:${t.p}`, label: t.p, indices: t.indices, run: () => d.onPick?.(t.p) }));
    },
  };
}
