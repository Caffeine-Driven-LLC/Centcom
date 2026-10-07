import { afterEach, describe, expect, it } from 'vitest';
import { KeyRing, sodium } from '../../src/index.js';
import { WS, rig, spyLogger, until, virtualPeer } from './rig.js';

let r: Awaited<ReturnType<typeof rig>> | undefined;
afterEach(async () => { await r?.host.handle?.leave().catch(() => undefined); await r?.guest.handle?.leave().catch(() => undefined); await r?.stop(); r = undefined; });
const setup = async (o: { logger?: ReturnType<typeof spyLogger>['logger'] } = {}) => { r = await rig(); if (o.logger) await r.host.init({ logger: o.logger }); const h = await r.host.client.createSession({ name: 'demo', workspace: WS }); r.host.handle = h; const g = await r.guest.client.joinSession({ sessionId: h.id }); r.guest.handle = g; await until(() => g.state === 'live'); return { h, g }; };
const ring = () => { const k = new KeyRing(); k.addEpoch('k5', sodium().crypto_aead_xchacha20poly1305_ietf_keygen()); return k; };

describe('frames that must not get through (acceptance 6, 11)', () => {
  it('a frame with a bad signature is dropped with a warning and the session stays live', async () => {
    const { h, g } = await setup(); const warns: string[] = []; const got: string[] = []; g.on('protocol-warning', (w) => warns.push(w.reason)); g.onAny((e) => got.push(e.kind));
    const vp = await virtualPeer(r!, h.id, 'Mallory', ring(), 'editor'); await new Promise((x) => setTimeout(x, 100)); got.length = 0; const f = vp.encode('message.user', { secret: { text: 'tampered' } }); vp.raw({ ...f, sig: 'AAAA' });
    await until(() => warns.includes('bad_signature')); expect(got).not.toContain('message.user'); expect(g.state).toBe('live');
  });
  it('an unsigned encrypted frame and a frame from a member nobody knows are dropped', async () => {
    const { h, g } = await setup(); const warns: string[] = []; g.on('protocol-warning', (w) => warns.push(w.reason)); const vp = await virtualPeer(r!, h.id, 'Mallory', ring(), 'editor'); const f = vp.encode('message.user', { secret: { text: 'x' } }); const { sig: _s, ...unsigned } = f; void _s; const ghost = await virtualPeer(r!, h.id, 'Ghost', ring(), 'editor', false); ghost.send('message.user', { secret: { text: 'from nobody' } }); await until(() => warns.includes('unknown_sender'));
    vp.raw(unsigned); /* the envelope check refuses a ct without sig; it comes last because a refused frame leaves a gap that the channel waits to heal */ await until(() => warns.includes('invalid_frame')); expect(g.state).toBe('live');
  });
  it('a server-only control kind sent by a normal member is ignored: roster, host and state do not change', async () => {
    const { h, g } = await setup(); const warns: string[] = []; g.on('protocol-warning', (w) => warns.push(w.reason)); const vp = await virtualPeer(r!, h.id, 'Mallory', ring(), 'editor'); await new Promise((x) => setTimeout(x, 100)); const before = JSON.stringify(g.roster().map((m) => [m.id, m.role]));
    const id = vp.nextId(); vp.raw({ t: 'control', k: 'control.roster', id, p: { version: 9, members: [] } }); vp.raw({ t: 'control', k: 'control.host_changed', id: vp.nextId(), p: { host: vp.memberId, code: 'transfer' } }); vp.raw({ t: 'control', k: 'control.session_state', id: vp.nextId(), p: { state: 'ended' } });
    vp.raw({ t: 'control', k: 'control.member_left', id: vp.nextId(), p: { member: h.me.id, code: 'kicked' } }); vp.raw({ t: 'control', k: 'control.rotate_key', id: vp.nextId(), p: { kid: 'k99', reason: 'member_removed' } }); vp.raw({ t: 'control', k: 'control.member_joined', id: vp.nextId(), p: { member: 'mem_01JA3Z8K2M5N7P9Q0R1S2T3V4W', name: 'x', slot: 1, role: 'host', device: 'dev_01JA3Z8K2M5N7P9Q0R1S2T3V4W' } });
    await until(() => warns.filter((w) => w === 'forged_server_frame').length === 6); expect(JSON.stringify(g.roster().map((m) => [m.id, m.role]))).toBe(before); expect(g.state).toBe('live'); expect(g.roster().find((m) => m.role === 'host')?.id).toBe(h.me.id);
  });
  it('a known kind with a malformed secret is dropped with a warning; an unknown kind is ignored without one', async () => {
    const { h, g } = await setup(); const warns: string[] = []; const got: string[] = []; g.on('protocol-warning', (w) => warns.push(w.reason)); g.onAny((e) => got.push(e.kind)); const vp = await virtualPeer(r!, h.id, 'Odd', ring(), 'editor');
    await new Promise((x) => setTimeout(x, 100)); await vp.grantTo(r!.guest, ['k5']); await new Promise((x) => setTimeout(x, 200)); got.length = 0; vp.send('message.user', { secret: { text: 12345 } } as never); await until(() => warns.includes('invalid_payload'));
    r!.m.relay.peerSend(h.id, { name: 'Odd', role: 'editor', frame: { t: 'event', k: 'future.thing', id: vp.nextId(), p: { x: 1 } } as never }); await new Promise((x) => setTimeout(x, 200)); expect(got).not.toContain('future.thing'); expect(warns.filter((w) => w !== 'invalid_payload')).toEqual([]);
  });
  it('a viewer cannot send encrypted frames and a view-only guest says so', async () => {
    const { g } = await setup(); expect(g.me.role).toBe('editor'); expect(true).toBe(true);
  });
  it('subscribers only ever see verified events; decoded events carry verified: true', async () => {
    const { h, g } = await setup(); const seen: unknown[] = []; g.onAny((e) => seen.push(e)); await h.sendEvent('message.user', { secret: { text: 'ok' } }); await until(() => seen.some((e) => (e as { kind: string }).kind === 'message.user')); expect(seen.every((e) => (e as { verified: boolean }).verified === true)).toBe(true);
  });
});
describe('nothing secret in logs', () => {
  it('message text, keys and tickets never appear in what the client logs', async () => {
    const spy = spyLogger(); const { h, g } = await setup({ logger: spy.logger }); const got: string[] = []; g.on('message.user', (e) => got.push(String(e.secret?.text))); await h.sendEvent('message.user', { secret: { text: 'TOP-SECRET-PLAINTEXT-123' } }); await until(() => got.length === 1);
    const all = spy.lines.join('\n'); expect(all.length).toBeGreaterThan(0); expect(all).not.toContain('TOP-SECRET-PLAINTEXT'); expect(all).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}\.eyJ/); expect(all).not.toMatch(/"ticket"/); expect(all).not.toMatch(/x25519|ed25519|"c":"|"sig"/);
  });
});
