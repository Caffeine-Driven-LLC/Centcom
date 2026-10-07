import { createModelRegistry, type Capability, type ModelConfig, type ModelDeps } from '../../src/index.js';

export function rig(o: { config?: ModelConfig; caps?: Capability[]; list?: { id: string; label?: string }[]; version?: string; files?: Map<string, string>; now?: number } = {}) {
  const files = o.files ?? new Map<string, string>(); let now = o.now ?? 1_000_000; const changed: unknown[] = []; const notes: { level: string; text: string; detail?: string }[] = []; let listCalls = 0; let version = o.version;
  const engine = { id: 'claude-code' as const, capabilities: () => new Set<Capability>(o.caps ?? ['models.list']), listModels: async () => { listCalls++; return o.list ?? [{ id: 'm-a' }, { id: 'm-b', label: 'Model B' }]; }, version: () => version };
  const deps: ModelDeps = { config: () => o.config ?? {}, bus: { emit: (_k, p) => changed.push(p) }, engines: { get: (id) => (id === 'claude-code' || id === 'codex' ? { ...engine, id } : undefined) }, cachePath: '/data/models-cache.json', fs: { read: async (p) => files.get(p), write: async (p, t) => { files.set(p, t); } }, clock: { now: () => now }, notify: (level, text, detail) => notes.push({ level, text, detail }) };
  const reg = createModelRegistry(deps); const set: string[] = [];
  reg.attach({ agentId: 'a1', engine: 'claude-code', setModel: (m) => set.push(m) });
  return { reg, files, changed, notes, set, listCalls: () => listCalls, advance: (ms: number) => { now += ms; }, setVersion: (v: string) => { version = v; }, deps, engine };
}
