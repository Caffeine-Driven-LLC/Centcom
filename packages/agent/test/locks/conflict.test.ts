import { assertWritableEventPayload } from '@centcom/protocol';
import { describe, expect, it } from 'vitest';
import { A, B, macWith, rig } from './helpers.js';

const mac = macWith(); const ev = (agent: string, key: string, ttl = 30_000) => ({ action: 'acquire', agent_id: agent, path_hmac: mac(key), ttl_ms: ttl }) as never;
describe('conflicts (acceptance 6)', () => {
  it('a remote acquire for a file a local agent holds gives one lock:conflict and one conflict.detected payload', async () => {
    const r = rig({ pathMac: mac }); await r.client.acquire('src/a.ts', { agentId: A }); r.client.onRemoteLock(ev(B, 'src/a.ts')); r.client.onRemoteLock(ev(B, 'src/a.ts')); r.client.onRemoteLock(ev(B, 'src/other.ts'));
    const c = r.events.filter((e) => e.k === 'lock:conflict'); expect(c).toHaveLength(1); expect(c[0]!.p).toEqual({ agent_id: A, other_agent_id: B, path: 'src/a.ts' }); expect(r.conflicts).toEqual([{ agent_ids: [A, B], path_hmacs: [mac('src/a.ts')] }]); expect(() => assertWritableEventPayload('conflict.detected', r.conflicts[0])).not.toThrow();
    expect(r.client.conflicts()).toEqual([{ agentIds: [A, B], path_hmac: mac('src/a.ts') }]); expect(r.client.conflictPayload(r.client.conflicts()[0]!)).toEqual(r.conflicts[0]);
  });
  it('the other order: a local acquire for a file a teammate already holds is a conflict too', async () => { const r = rig({ pathMac: mac }); r.client.onRemoteLock(ev(B, 'x')); await r.client.acquire('x', { agentId: A }); expect(r.events.filter((e) => e.k === 'lock:conflict')).toHaveLength(1); expect(r.conflicts).toHaveLength(1); });
  it('no conflict once the lock is released or has expired, and a different file is none', async () => { const r = rig({ pathMac: mac }); await r.client.acquire('x', { agentId: A }); r.client.onRemoteLock(ev(B, 'x', 5000)); expect(r.client.conflicts()).toHaveLength(1); await r.clock.advance(5000); expect(r.client.conflicts()).toEqual([]); await r.client.release('x', A); expect(r.client.conflicts()).toEqual([]); });
  it('without a path key there is nothing to compare, so no conflicts are invented', async () => { const r = rig(); await r.client.acquire('x', { agentId: A }); r.client.onRemoteLock(ev(B, 'x')); expect(r.client.conflicts()).toEqual([]); expect(r.events.filter((e) => e.k === 'lock:conflict')).toEqual([]); });
});
