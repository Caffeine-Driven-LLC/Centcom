import { VirtualClock } from '@centcom/testkit';
import { createHooksManager, type Capability, type HooksFs, type HookScope } from '../../src/index.js';

export const ROOT = '/work/proj'; export const HOME = '/home/me';
export const P = { project: `${ROOT}/.claude/settings.json`, local: `${ROOT}/.claude/settings.local.json`, user: `${HOME}/.claude/settings.json` };
export function memFs(files: Record<string, string> = {}) {
  const f = new Map(Object.entries(files)); const counts = { writes: 0, removes: 0 }; let failWrites: ((p: string) => boolean) | undefined;
  const fs: HooksFs = {
    async read(p) { return f.get(p); },
    async writeAtomic(p, t) { if (failWrites?.(p)) throw new Error('EACCES'); counts.writes++; f.set(p, t); },
    async list(dir) { return [...f.keys()].filter((k) => k.startsWith(dir + '/') && !k.slice(dir.length + 1).includes('/')).map((k) => k.slice(dir.length + 1)); },
    async remove(p) { counts.removes++; f.delete(p); },
  };
  return { fs, files: f, counts, failWrites: (fn?: (p: string) => boolean) => { failWrites = fn; } };
}
export function rig(files: Record<string, string> = {}, o: { caps?: boolean; which?: (c: string) => string | undefined; confirmed?: boolean } = {}) {
  const m = memFs(files); const clock = new VirtualClock(); const store = new Map<string, string>();
  const mgr = createHooksManager({ fs: m.fs, clock, which: o.which, ...(o.confirmed ? { confirmed: { get: async (p) => store.get(p), set: async (p, h) => { store.set(p, h); } } } : {}),
    engines: { capabilities: () => (o.caps === false ? undefined : new Set<Capability>(['usage'])), settingsPaths: (engine, scope: HookScope, root) => (engine === 'claude-code' ? (scope === 'user' ? P.user : root ? `${root}/.claude/settings${scope === 'local' ? '.local' : ''}.json` : undefined) : undefined) } });
  return { ...m, mgr, clock, store };
}
export const SETTINGS = '{\n  "permissions": { "allow": ["Bash(ls)"], "deny": [] },\n  "env": {"A":"1"}\n}\n';
export const FMT = { matcher: 'Edit|Write', command: "jq -r '.tool_input.file_path' | xargs prettier --write", timeout_s: 60 };
