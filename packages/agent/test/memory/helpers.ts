import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryFiles, defaultMemoryPaths, nodeMemFs, type MemFs } from '../../src/index.js';

/** An in-memory file system that counts writes, for the "nothing was written" checks. */
export function memFs(files: Record<string, string> = {}) {
  const m = new Map(Object.entries(files).map(([k, v]) => [k, Buffer.from(v)])); const w = { writes: 0 };
  const fs: MemFs = { read: async (p) => (m.has(p) ? { bytes: m.get(p)!, mode: 0o644 } : undefined), writeAtomic: async (p, b) => { w.writes++; m.set(p, Buffer.from(b)); } };
  return { fs, files: m, w, text: (p: string) => m.get(p)?.toString('utf8') };
}
export function rig(o: { files?: Record<string, string>; sync?: boolean; fs?: MemFs } = {}) {
  const root = '/proj'; const home = '/home/u'; const mem = memFs(Object.fromEntries(Object.entries(o.files ?? {}).map(([k, v]) => [k.startsWith('/') ? k : `${root}/${k}`, v])));
  const logs: string[] = []; const mf = createMemoryFiles({ fs: o.fs ?? mem.fs, engines: defaultMemoryPaths(home), config: { sync: o.sync ?? false }, log: { info: (m, c) => logs.push(m + JSON.stringify(c ?? {})), warn: (m) => logs.push(m) } });
  return { mf, mem, root, home, logs, claude: `${root}/CLAUDE.md`, agents: `${root}/AGENTS.md`, source: `${root}/.centcom/memory.md` };
}
export function realRig(files: Record<string, string> = {}) { const root = realpathSync(mkdtempSync(join(tmpdir(), 'mem-'))); for (const [k, v] of Object.entries(files)) { mkdirSync(join(root, k, '..'), { recursive: true }); writeFileSync(join(root, k), v); } return { root }; }
export const confirm = (plan: { planHash: string }) => ({ accepted: true as const, planHash: plan.planHash });
export { nodeMemFs };
