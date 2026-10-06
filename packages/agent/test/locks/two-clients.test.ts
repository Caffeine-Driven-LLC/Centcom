import { describe, expect, it } from 'vitest';
import { createAgentBus, createLockClient, nodeLockFs, type FileLockPayload, type LockClient, type LockTransport } from '../../src/index.js';
import { VirtualClock } from '@centcom/testkit';
import { A, B, macWith, tmp } from './helpers.js';

/** A stand-in for the relay: it numbers frames (`seq`) and hands every frame to every other client, as the real one does. */
function hub() { let seq = 0; const members: { id: string; client?: LockClient }[] = []; const log: { seq: number; from: string; clear: FileLockPayload; secret: { path: string } }[] = [];
  const transportFor = (id: string): LockTransport => ({ publish: (p) => { const f = { seq: ++seq, from: id, ...p }; log.push(f); for (const m of members) if (m.id !== id) m.client?.onRemoteLock(f.clear); } }); return { members, log, transportFor }; }
describe('two clients through a relay stand-in', () => {
  it('see each other, conflict once, and the relay only ever sees hashes', async () => {
    const h = hub(); const mk = (id: string) => { const t = tmp(); const clock = new VirtualClock(); const bus = createAgentBus({ onError: (e) => { throw e; } }); const conflicts: unknown[] = []; const m = { id } as { id: string; client?: LockClient }; h.members.push(m);
      m.client = createLockClient({ root: t.dir, fs: nodeLockFs, clock, bus, config: { mode: 'warn', defaultTtlMs: 60_000 }, pathMac: macWith('shared'), transport: h.transportFor(id), onConflictDetected: (p) => conflicts.push(p) }); return { m, clock, conflicts, client: m.client }; };
    const x = mk('x'); const y = mk('y');
    expect(await x.client.acquire('src/shared.ts', { agentId: A })).toEqual({ ok: true }); expect(y.client.check('src/shared.ts')).toMatchObject({ heldBy: A, remote: true });
    expect(await y.client.acquire('src/shared.ts', { agentId: B })).toEqual({ ok: true, heldBy: A }); expect(x.conflicts).toHaveLength(1); expect(y.conflicts).toHaveLength(1); expect(x.conflicts[0]).toEqual({ agent_ids: [A, B], path_hmacs: [macWith('shared')('src/shared.ts')] });
    await x.client.release('src/shared.ts', A); expect(y.client.check('src/shared.ts')).toMatchObject({ heldBy: B, remote: false }); expect(h.log.map((f) => [f.seq, f.from, f.clear.action])).toEqual([[1, 'x', 'acquire'], [2, 'y', 'acquire'], [3, 'x', 'release']]); expect(JSON.stringify(h.log.map((f) => f.clear))).not.toContain('shared.ts');
  });
});
