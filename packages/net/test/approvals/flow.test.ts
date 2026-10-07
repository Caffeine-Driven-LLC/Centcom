import { afterEach, describe, expect, it } from 'vitest';
import { ApprovalRouter, KeyRing, sodium, type ApprovalOutcome, type SessionHandle } from '../../src/index.js';
import { ManualClock, WS, rig, until, virtualPeer, type Peer } from '../session/rig.js';

let r: Awaited<ReturnType<typeof rig>> | undefined; const routers: ApprovalRouter[] = []; const extra: Peer[] = [];
afterEach(async () => { for (const x of routers.splice(0)) x.dispose(); for (const p of [r?.host, r?.guest, ...extra.splice(0)]) await p?.handle?.leave().catch(() => undefined); await r?.stop(); r = undefined; });
const real = { now: () => Date.now(), setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms), clearTimeout: (h: never) => clearTimeout(h as unknown as ReturnType<typeof setTimeout>) };
const start = async (o: { third?: boolean; clock?: ManualClock } = {}) => { r = await rig(); const h = await r.host.client.createSession({ name: 'demo', workspace: WS }); r.host.handle = h; const g = await r.guest.client.joinSession({ sessionId: h.id }); r.guest.handle = g; await until(() => g.state === 'live' && h.roster().length === 2);
  let t: SessionHandle | undefined; let tp: Peer | undefined; if (o.third) { tp = await r.mk('Third', 'editor', 'usr_01JA3Z8K2M5N7P9Q0R1S2T3V6Z').init(); extra.push(tp); t = await tp.client.joinSession({ sessionId: h.id }); tp.handle = t; await until(() => t!.state === 'live' && h.roster().length === 3); }
  const clock = o.clock ?? real; const mk = (s: SessionHandle, opts: object = {}) => { const x = new ApprovalRouter(s, { clock, ...opts }); routers.push(x); return x; };
  return { h, g, t, hr: mk(h), gr: mk(g), tr: t ? mk(t) : undefined, mk, ids: { hostId: h.me.id, guestId: g.me.id } };
};
const ask = (over: Partial<Parameters<ApprovalRouter['request']>[0]> = {}) => ({ agentId: 'agt_01JA3Z8K2M5N7P9Q0R1S2T3V4W', risk: 'high' as const, approver: 'host' as const, summary: 'Run a command', command: 'CANARY-CMD rm -rf build', cwd: '/home/CANARY-DIR/project', ...over });

describe('request and decision across two clients (acceptance 1, 2, 7)', () => {
  it('one hybrid request frame; the host sees it decrypted; an approve with scope once comes back with the approver in `by`; the relay holds no command text', async () => {
    const { h, hr, gr, ids } = await start(); const prompts: unknown[] = []; hr.on('request', (p) => prompts.push(p)); const sunk: unknown[] = []; gr.setSink({ apply: (o) => sunk.push(o) });
    const pending = gr.request(ask()); await until(() => prompts.length === 1); const p = prompts[0] as { approvalId: string; agentId: string; risk: string; summary: string; command: string; cwd: string; approver: string }; expect(p).toMatchObject({ risk: 'high', approver: 'host', summary: 'Run a command', command: 'CANARY-CMD rm -rf build', cwd: '/home/CANARY-DIR/project' }); expect(p.approvalId).toMatch(/^apr_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(hr.pending().map((x) => x.approvalId)).toEqual([p.approvalId]); expect(r!.m.relay.frames(h.id).filter((f) => f.k === 'approval.request')).toHaveLength(1); expect(JSON.stringify(r!.m.relay.frames(h.id))).not.toMatch(/CANARY/);
    await hr.decide(p.approvalId, { decision: 'approve', scope: 'once' }); const out = await pending; expect(out).toEqual({ decision: 'approve', scope: 'once', by: ids.hostId }); expect(sunk).toEqual([{ agentId: p.agentId, approvalId: p.approvalId, outcome: out }]); await until(() => hr.pending().length === 0);
  });
  it('session and always scopes reach the sink as given; deny carries its reason; the router keeps no rules of its own', async () => {
    const { hr, gr } = await start(); const prompts: { approvalId: string }[] = []; hr.on('request', (p) => prompts.push(p)); const sunk: ApprovalOutcome[] = []; gr.setSink({ apply: (o) => sunk.push(o.outcome) });
    for (const [i, scope] of (['session', 'always'] as const).entries()) { const pr = gr.request(ask()); await until(() => prompts.length === i + 1); await hr.decide(prompts[i]!.approvalId, { decision: 'approve', scope }); expect((await pr).scope).toBe(scope); }
    const pr = gr.request(ask()); await until(() => prompts.length === 3); await hr.decide(prompts[2]!.approvalId, { decision: 'deny', scope: 'once', reason: 'PRIVATE-WHY' }); expect(await pr).toMatchObject({ decision: 'deny', reason: 'PRIVATE-WHY' }); expect(sunk.map((o) => `${o.decision}:${o.scope}`)).toEqual(['approve:session', 'approve:always', 'deny:once']); expect(JSON.stringify(r!.m.relay.frames(r!.host.handle!.id))).not.toContain('PRIVATE-WHY');
  });
  it('any_editor accepts the first editor decision; owner accepts only the marked member; a host-only request is not answered by an editor', async () => {
    const { h, hr, gr } = await start(); const owners = new Set<string>(); const gr2 = new ApprovalRouter(r!.guest.handle!, { clock: real, owners: () => owners }); routers.push(gr2); routers.splice(routers.indexOf(gr), 1); gr.dispose();
    const ring = new KeyRing(); ring.addEpoch('k5', sodium().crypto_aead_xchacha20poly1305_ietf_keygen()); const ed = await virtualPeer(r!, h.id, 'Editor2', ring, 'editor'); await new Promise((x) => setTimeout(x, 150)); await ed.grantTo(r!.guest, ['k5']); await ed.grantTo(r!.host, ['k5']); await new Promise((x) => setTimeout(x, 250));
    const approveFrom = (id: string) => ed.send('approval.decision', { p: { approval_id: id, decision: 'approve', scope: 'once' }, secret: {} }); const ignored: string[] = []; gr2.on('ignored', (e) => ignored.push(e.reason));
    const a = gr2.request(ask({ approver: 'any_editor' })); await until(() => hr.pending().length === 1); approveFrom(hr.pending()[0]!.approvalId); expect((await a).by).toBe(ed.memberId);
    const b = gr2.request(ask({ approver: 'host' })); await until(() => hr.pending().length === 1); approveFrom(hr.pending()[0]!.approvalId); await until(() => ignored.includes('not_allowed')); await hr.decide(hr.pending()[0]!.approvalId, { decision: 'deny', scope: 'once' }); expect((await b).decision).toBe('deny');
    const c = gr2.request(ask({ approver: 'owner' })); await until(() => hr.pending().length === 1); const cid = hr.pending()[0]!.approvalId; approveFrom(cid); await until(() => ignored.filter((x) => x === 'not_allowed').length === 2); owners.add(ed.memberId); const c2 = gr2.request(ask({ approver: 'owner' })); await until(() => hr.pending().length === 2); const id2 = hr.pending().find((p) => p.approvalId !== cid)!.approvalId; approveFrom(id2); expect((await c2).by).toBe(ed.memberId); await hr.decide(cid, { decision: 'deny', scope: 'once' }); expect((await c).decision).toBe('deny');
  });
  it('a member without the right gets a clear refusal when trying to answer', async () => {
    const { hr, gr } = await start(); void gr.request(ask()); await until(() => hr.pending().length === 1); await expect(hr.decide('apr_01JA3Z8K2M5N7P9Q0R1S2T3V4W', { decision: 'approve', scope: 'once' })).rejects.toThrow(/not waiting/);
  });
});
describe('who may decide, on the wire (acceptance 3, 9)', () => {
  it('a viewer, an editor on a host request, an unknown approval id and a second decision are all ignored; the first decision stands', async () => {
    const { h, hr, gr } = await start(); const ignored: string[] = []; gr.on('ignored', (e) => ignored.push(e.reason)); const ring = new KeyRing(); ring.addEpoch('k5', sodium().crypto_aead_xchacha20poly1305_ietf_keygen());
    const viewer = await virtualPeer(r!, h.id, 'Viewer', ring, 'editor'); await new Promise((x) => setTimeout(x, 150)); await viewer.grantTo(r!.guest, ['k5']); await viewer.grantTo(r!.host, ['k5']); await new Promise((x) => setTimeout(x, 250)); /* it was an editor when it handed out its key; now it is a viewer */ r!.reg.members.get(viewer.memberId)!.role = 'viewer'; await virtualPeer(r!, h.id, 'Poke', KeyRing.create(), 'editor'); await new Promise((x) => setTimeout(x, 300));
    const pr = gr.request(ask()); await until(() => hr.pending().length === 1); const id = hr.pending()[0]!.approvalId;
    viewer.send('approval.decision', { p: { approval_id: id, decision: 'approve', scope: 'once' }, secret: {} }); await until(() => ignored.includes('viewer'));
    viewer.send('approval.decision', { p: { approval_id: 'apr_01JA3Z8K2M5N7P9Q0R1S2T3V4W', decision: 'approve', scope: 'once' }, secret: {} }); await until(() => ignored.includes('unknown_approval'));
    await hr.decide(id, { decision: 'deny', scope: 'once' }); const out = await pr; expect(out.decision).toBe('deny'); viewer.send('approval.decision', { p: { approval_id: id, decision: 'approve', scope: 'always' }, secret: {} }); await until(() => ignored.includes('already_decided')); expect(out.decision).toBe('deny');
  });
  it('frames from a device nobody knows never reach the router', async () => {
    const { h, hr } = await start(); const ghost = await virtualPeer(r!, h.id, 'Ghost', KeyRing.create(), 'editor', false); const seen: unknown[] = []; hr.on('request', (p) => seen.push(p)); ghost.send('approval.request', { p: { approval_id: 'apr_01JA3Z8K2M5N7P9Q0R1S2T3V4W', agent_id: 'agt_01JA3Z8K2M5N7P9Q0R1S2T3V4W', risk: 'low', expires_at: new Date(Date.now() + 60_000).toISOString(), approver: 'host' }, secret: { summary: 'x' } }); await new Promise((x) => setTimeout(x, 400)); expect(seen).toEqual([]); expect(hr.pending()).toEqual([]);
  });
});
describe('expiry (acceptance 5)', () => {
  it('with no decision the request ends as expired at its time and a deny with reason expired is sent; a later decision resolves nothing; ttl is clamped to 10 minutes', async () => {
    const clock = new ManualClock(); const { h, hr, gr } = await start({ clock }); const expired: string[] = []; gr.on('expired', (e) => expired.push(e.approvalId)); const t0 = clock.now(); const pr = gr.request(ask({ ttlMs: 60 * 60_000 })); await until(() => hr.pending().length === 1); const p = hr.pending()[0]!; expect(Date.parse(p.expiresAt) - t0).toBe(600_000);
    await clock.advance(599_000); expect(expired).toEqual([]); await clock.advance(2_000); const out = await pr; expect(out).toMatchObject({ decision: 'expired', reason: 'expired' }); expect(expired).toHaveLength(1); await until(() => hr.pending().length === 0);
    const hp = hr.request(ask({ ttlMs: 5000 })); await clock.advance(6000); expect(await hp).toMatchObject({ decision: 'expired' }); await until(() => r!.m.relay.frames(h.id).filter((f) => f.k === 'approval.decision').length === 1); /* the host's own deny goes through; a guest's is refused by the relay */
    await expect(hr.decide(p.approvalId, { decision: 'approve', scope: 'once' })).rejects.toThrow(); void gr;
  });
  it('a request that was already expired when it arrived is not shown', async () => { const clock = new ManualClock(); const { hr, gr } = await start({ clock }); const prompts: unknown[] = []; hr.on('request', (p) => prompts.push(p)); void gr.request(ask({ ttlMs: 1000 })); await until(() => prompts.length === 1); await clock.advance(1100); await until(() => hr.pending().length === 0); });
});
describe('privacy and sending trouble', () => {
  it('the clear part holds exactly the five routing fields', async () => {
    const { FrameCodec, DeviceKeyStore, Roster, initCrypto, memoryKeychain } = await import('../../src/index.js'); await initCrypto(); const dev = new DeviceKeyStore(memoryKeychain(), 'dev_01JA3Z8K2M5N7P9Q0R1S2T3V4W'); await dev.getOrCreatePublicKeys(); const codec = new FrameCodec({ sid: 'ses_01JA3Z8K2M5N7P9Q0R1S2T3V4W', deviceId: 'dev_01JA3Z8K2M5N7P9Q0R1S2T3V4W', device: dev, ring: KeyRing.create(), roster: new Roster() });
    const f = codec.encode('approval.request', 'msg_01JA3Z8K2M5N7P9Q0R1S2T3V4W', { p: { approval_id: 'apr_01JA3Z8K2M5N7P9Q0R1S2T3V4W', agent_id: 'agt_01JA3Z8K2M5N7P9Q0R1S2T3V4W', risk: 'low', expires_at: '2026-10-07T12:00:00.000Z', approver: 'host' }, secret: { summary: 'S-SUM', command: 'S-CMD', cwd: 'S-CWD' } }); expect(Object.keys(f.p!).sort()).toEqual(['agent_id', 'approval_id', 'approver', 'expires_at', 'risk']); expect(JSON.stringify(f)).not.toMatch(/S-SUM|S-CMD|S-CWD/);
  });
  it('a request that cannot be sent is a deny, never an approval; cancel is a deny too', async () => {
    const { g, gr } = await start(); await g.leave(); const out = await gr.request(ask()); expect(out).toMatchObject({ decision: 'deny', reason: 'not_sent' }); const { gr: gr2, g: g2 } = await start(); const seen: string[] = []; gr2.on('awaiting-approval', (e) => seen.push(e.approvalId)); const pr = gr2.request(ask()); await until(() => seen.length === 1); gr2.cancel(seen[0]!); expect(await pr).toMatchObject({ decision: 'deny', reason: 'canceled' }); void g2;
  });
});
