import { describe, expect, it } from 'vitest';
import { AGT, rig } from './helpers.js';

describe('requestCompaction (acceptance 4 and 5)', () => {
  it('without the compact capability: unsupported and nothing is sent', async () => { const r = rig({ caps: ['usage'] }); expect(await r.view.requestCompaction(AGT)).toEqual({ ok: false, reason: 'unsupported' }); expect(r.sends).toEqual([]); });
  it('sends exactly one /compact when the agent is waiting', async () => { const r = rig(); expect(await r.view.requestCompaction(AGT)).toEqual({ ok: true }); expect(r.sends).toEqual(['/compact']); });
  it('is busy while running or starting, and not_idle once exited', async () => { const r = rig(); for (const [s, reason] of [['running', 'busy'], ['starting', 'busy'], ['exited', 'not_idle']] as const) { r.setStatus(s); expect(await r.view.requestCompaction(AGT)).toEqual({ ok: false, reason }); } expect(r.sends).toEqual([]); });
  it('is busy during a pending approval, until it resolves', async () => { const r = rig(); r.push({ type: 'approval.requested', approval_id: 'apr_1', tool_id: 't', summary: 's', risk: 'low' }); expect(await r.view.requestCompaction(AGT)).toMatchObject({ reason: 'busy' }); r.push({ type: 'approval.resolved', approval_id: 'apr_1', decision: 'approve' } as never); expect(await r.view.requestCompaction(AGT)).toEqual({ ok: true }); });
  it('is busy while a compaction runs, and a failed send backs off for 60 s', async () => {
    const r = rig(); r.push({ type: 'compaction.started' }); expect(await r.view.requestCompaction(AGT)).toMatchObject({ reason: 'busy' }); r.push({ type: 'compaction.ended' });
    const f = rig({ sendFails: true }); expect(await f.view.requestCompaction(AGT)).toEqual({ ok: false, reason: 'failed' }); expect(await f.view.requestCompaction(AGT)).toMatchObject({ reason: 'busy' }); await f.clock.advance(60_000); expect(await f.view.requestCompaction(AGT)).toEqual({ ok: false, reason: 'failed' });
  });
  it('an error during a compaction also backs off', async () => { const r = rig(); r.push({ type: 'compaction.started' }); r.push({ type: 'error', code: 'x', message: 'm', fatal: false } as never); expect(await r.view.requestCompaction(AGT)).toMatchObject({ reason: 'busy' }); await r.clock.advance(60_000); expect(await r.view.requestCompaction(AGT)).toEqual({ ok: true }); });
});
describe('auto compaction', () => {
  const tick = () => new Promise((r) => setImmediate(r));
  it('is off by default', async () => { const r = rig(); r.usage(190_000, 200_000); r.push({ type: 'turn.done', outcome: 'ok' } as never); await tick(); expect(r.sends).toEqual([]); });
  it('asks once per cycle when on, idle and at the threshold', async () => {
    const r = rig({ config: { auto_compact: true } }); r.setStatus('running'); r.usage(180_000, 200_000); await tick(); expect(r.sends).toEqual([]); // 90%, but the agent is busy
    r.setStatus('waiting'); r.push({ type: 'turn.done', outcome: 'ok' } as never); await tick(); expect(r.sends).toEqual(['/compact']); r.push({ type: 'compaction.started' }); r.push({ type: 'compaction.ended' });
    r.push({ type: 'turn.done', outcome: 'ok' } as never); r.usage(185_000, 200_000); await tick(); expect(r.sends).toHaveLength(1);
    r.usage(100_000, 200_000); r.usage(180_000, 200_000); await tick(); expect(r.sends).toHaveLength(2); // a new cycle after the number fell below 75
  });
  it('does not ask below the threshold or without a percent', async () => { const r = rig({ config: { auto_compact: true } }); r.usage(100_000, 200_000); await tick(); expect(r.sends).toEqual([]); const q = rig({ config: { auto_compact: true } }); q.usage(190_000, undefined); await tick(); expect(q.sends).toEqual([]); });
});
