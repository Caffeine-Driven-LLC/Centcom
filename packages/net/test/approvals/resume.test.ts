import { afterEach, describe, expect, it } from 'vitest';
import { ApprovalRouter, KeyRing, memorySeqStore, sodium } from '../../src/index.js';
import { WS, rig, until, virtualPeer } from '../session/rig.js';

let r: Awaited<ReturnType<typeof rig>> | undefined; const routers: ApprovalRouter[] = [];
afterEach(async () => { for (const x of routers.splice(0)) x.dispose(); await r?.host.handle?.leave().catch(() => undefined); await r?.guest.handle?.leave().catch(() => undefined); await r?.stop(); r = undefined; });
const real = { now: () => Date.now(), setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms), clearTimeout: (h: never) => clearTimeout(h as unknown as ReturnType<typeof setTimeout>) };
const ask = () => ({ agentId: 'agt_01JA3Z8K2M5N7P9Q0R1S2T3V4W', risk: 'medium' as const, approver: 'any_editor' as const, summary: 'Edit a file', command: 'edit' });
const frames = (sid: string, k: string) => r!.m.relay.frames(sid).filter((f) => f.k === k);

describe('a disconnect between request and decision (acceptance 6, 8)', () => {
  it('the request goes out once, the approver sees one prompt, and the decision after the reconnect still resolves it', async () => {
    r = await rig(); await r.guest.init({ keyrings: true, seqStore: memorySeqStore() }); const h = await r.host.client.createSession({ name: 'demo', workspace: WS }); r.host.handle = h; const g = await r.guest.client.joinSession({ sessionId: h.id }); r.guest.handle = g; await until(() => g.state === 'live' && h.roster().length === 2);
    const hr = new ApprovalRouter(h, { clock: real }); const gr = new ApprovalRouter(g, { clock: real }); routers.push(hr, gr); const prompts: unknown[] = []; gr.on('request', (p) => prompts.push(p));
    const ring = new KeyRing(); ring.addEpoch('k5', sodium().crypto_aead_xchacha20poly1305_ietf_keygen()); const ed = await virtualPeer(r, h.id, 'Editor2', ring, 'editor'); await new Promise((x) => setTimeout(x, 150)); await ed.grantTo(r.guest, ['k5']); await ed.grantTo(r.host, ['k5']); await new Promise((x) => setTimeout(x, 250));
    const pr = hr.request(ask()); await r.m.control('disconnect', { sid: h.id, code: 1001 }); await until(() => gr.pending().length === 1, 8000); await new Promise((x) => setTimeout(x, 400)); expect(prompts).toHaveLength(1); expect(frames(h.id, 'approval.request')).toHaveLength(1);
    ed.send('approval.decision', { p: { approval_id: gr.pending()[0]!.approvalId, decision: 'approve', scope: 'session' }, secret: {} }); expect(await pr).toMatchObject({ decision: 'approve', scope: 'session', by: ed.memberId }); await until(() => gr.pending().length === 0);
  });
  it('an approver that comes back sees the requests that are still open, once each, and not the ones already decided', { timeout: 30_000 }, async () => {
    r = await rig(); const seq = memorySeqStore(); await r.guest.init({ keyrings: true, seqStore: seq }); const h = await r.host.client.createSession({ name: 'demo', workspace: WS }); r.host.handle = h; const g1 = await r.guest.client.joinSession({ sessionId: h.id }); r.guest.handle = g1; await until(() => g1.state === 'live' && h.roster().length === 2);
    const hr = new ApprovalRouter(h, { clock: real }); routers.push(hr); const ring = new KeyRing(); ring.addEpoch('k5', sodium().crypto_aead_xchacha20poly1305_ietf_keygen()); const ed = await virtualPeer(r, h.id, 'Editor2', ring, 'editor'); await new Promise((x) => setTimeout(x, 150)); await ed.grantTo(r.guest, ['k5']); await ed.grantTo(r.host, ['k5']); await new Promise((x) => setTimeout(x, 250));
    await g1.leave(); const a = hr.request(ask()); const b = hr.request(ask()); await until(() => frames(h.id, 'approval.request').length === 2); await new Promise((x) => setTimeout(x, 200));
    const g2 = await r.guest.client.joinSession({ sessionId: h.id }); r.guest.handle = g2; await until(() => g2.state === 'live'); const gr = new ApprovalRouter(g2, { clock: real }); routers.push(gr); await until(() => gr.pending().length === 2, 8000); await new Promise((x) => setTimeout(x, 400)); const prompts = gr.pending().map((p) => p.approvalId);
    expect(prompts).toHaveLength(2); expect(new Set(prompts).size).toBe(2); expect(gr.pending()).toHaveLength(2);
    ed.send('approval.decision', { p: { approval_id: prompts[0]!, decision: 'deny', scope: 'once' }, secret: {} }); await until(() => gr.pending().length === 1); expect(gr.pending()[0]!.approvalId).toBe(prompts[1]); expect(await Promise.race([a, b])).toMatchObject({ decision: 'deny', by: ed.memberId });
  });
});
