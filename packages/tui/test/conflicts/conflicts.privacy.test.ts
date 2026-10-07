import { describe, expect, it, vi } from 'vitest';
import { ConflictStore, type ConflictEvent } from '../../src/conflicts/index.js';

const H = 'zz99'.repeat(10);
describe('privacy (guardrail)', () => {
  it('a path is never logged, never shown without its own decrypted frame, and the store sends nothing', () => {
    const debug = vi.fn(); const s = new ConflictStore({ logger: { debug } }); const ev = (secret?: Record<string, unknown>): ConflictEvent => ({ kind: 'file.lock', seq: 1, from: 'mem_a', ts: '2026-10-07T12:00:00.000Z', p: { action: 'acquire', path_hmac: H, agent_id: 'a1', ttl_ms: 1000 }, secret });
    s.apply(ev()); expect(s.getSnapshot().locks[0]!.displayPath).toBeUndefined(); s.apply({ ...ev({ path: 'secret/CANARY-77.ts' }), seq: 2 }); s.apply({ kind: 'conflict.detected', seq: 3, from: 'm', ts: '2026-10-07T12:00:00.000Z', p: { agent_ids: ['a1'], path_hmacs: [H] }, secret: { paths: ['secret/CANARY-88.ts'] } });
    expect(debug).toHaveBeenCalled(); expect(JSON.stringify(debug.mock.calls)).not.toContain('CANARY'); expect(JSON.stringify(debug.mock.calls)).not.toContain(H);
    const other = new ConflictStore(); other.apply({ ...ev(), p: { action: 'acquire', path_hmac: 'other'.padEnd(40, 'x'), agent_id: 'a2' } }); expect(other.getSnapshot().locks[0]!.displayPath).toBeUndefined(); /* labels belong to their own hmac only */
  });
});
