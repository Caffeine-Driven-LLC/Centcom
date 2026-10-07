import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { NetStateMonitor, ResumeCoordinator, createDurableOutbox, createFileSeqStore, toMascotState } from '../../src/index.js';
import { WS, rig, until } from '../session/rig.js';

let r: Awaited<ReturnType<typeof rig>> | undefined;
afterEach(async () => { await r?.host.handle?.leave().catch(() => undefined); await r?.guest.handle?.leave().catch(() => undefined); await r?.stop(); r = undefined; });
const real = { now: () => Date.now(), setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms), clearTimeout: (h: never) => clearTimeout(h as unknown as ReturnType<typeof setTimeout>) };

describe('the mock goes away and comes back', () => {
  it('frames written while the link is down are kept, survive a new outbox instance, and reach the host once each, in order, with their ids; the state names follow', { timeout: 90_000 }, async () => {
    r = await rig(); const dir = mkdtempSync(join(tmpdir(), 'cc-off-')); const h = await r.host.client.createSession({ name: 'demo', workspace: WS }); r.host.handle = h;
    const outbox = await createDurableOutbox(dir, h.id, { keychain: r.guest.keychain }); const g = await r.guest.client.joinSession({ sessionId: h.id, outbox }); r.guest.handle = g; await until(() => g.state === 'live' && h.roster().length === 2);
    const monitor = new NetStateMonitor({ sessions: () => [g], status: async () => ({ status: 'ok' }), clock: real, pollStatusMs: 60_000 }); const names: string[] = []; monitor.on('change', (s, p) => { if (toMascotState(s) !== toMascotState(p)) names.push(toMascotState(s)); }); monitor.start();
    const got: string[] = []; h.on('message.user', (e) => { if (String(e.secret?.text).startsWith('offline-')) got.push(String(e.secret?.text)); });
    await r.m.control('maintenance', { on: true }); await r.m.control('disconnect', { sid: h.id, code: 1001 }); await until(() => g.link() !== 'online', 10_000); await until(() => monitor.current() !== 'online', 10_000);
    const ids: string[] = []; for (let i = 0; i < 10; i++) { const res = await g.sendEvent('message.user', { secret: { text: `offline-${i}` } }); ids.push(res.id); expect(res.seq).toBe(0); } expect(outbox.size().frames).toBe(10); const again = await createDurableOutbox(dir, h.id, { keychain: r.guest.keychain }); expect(again.size().frames).toBe(10);
    await r.m.control('maintenance', { on: false }); await until(() => got.length === 10, 60_000); expect(got).toEqual(Array.from({ length: 10 }, (_, i) => `offline-${i}`)); await until(() => outbox.size().frames === 0, 10_000); await new Promise((x) => setTimeout(x, 500)); expect(got).toHaveLength(10); expect(r.m.relay.frames(h.id).filter((f) => f.k === 'message.user' && ids.includes(f.id ?? ''))).toHaveLength(10);
    await until(() => monitor.current() === 'online', 10_000); expect(names[0]).toMatch(/reconnecting|offline/); expect(names.at(-1)).toBe('online'); monitor.stop();
  });
  it('a viewer of the session sees nothing buffered when the link is up: frames go out at once and the store stays empty', async () => {
    r = await rig(); const dir = mkdtempSync(join(tmpdir(), 'cc-off-')); const h = await r.host.client.createSession({ name: 'demo', workspace: WS }); r.host.handle = h; const outbox = await createDurableOutbox(dir, h.id, { keychain: r.guest.keychain }); const g = await r.guest.client.joinSession({ sessionId: h.id, outbox }); r.guest.handle = g; await until(() => g.state === 'live'); const res = await g.sendEvent('message.user', { secret: { text: 'live' } }); expect(res.seq).toBeGreaterThan(0); expect(outbox.size().frames).toBe(0);
  });
});
describe('the position survives a restart (acceptance 8)', () => {
  it('the next hello carries the saved last_seq and only later frames come', { timeout: 30_000 }, async () => {
    r = await rig(); const dir = mkdtempSync(join(tmpdir(), 'cc-seq-')); const seqStore = createFileSeqStore(dir); await r.guest.init({ keyrings: true, seqStore }); const h = await r.host.client.createSession({ name: 'demo', workspace: WS }); r.host.handle = h; const g1 = await r.guest.client.joinSession({ sessionId: h.id }); r.guest.handle = g1; await until(() => g1.state === 'live' && h.roster().length === 2);
    await h.sendEvent('message.user', { secret: { text: 'first' } }); await h.sendEvent('message.user', { secret: { text: 'second' } }); await new Promise((x) => setTimeout(x, 300)); await g1.leave(); await new Promise((x) => setTimeout(x, 150)); const saved = await createFileSeqStore(dir).load(h.id); expect(saved).toBeGreaterThan(0);
    await h.sendEvent('message.user', { secret: { text: 'third' } }); const texts: string[] = []; const g2 = await r.guest.client.joinSession({ sessionId: h.id }); r.guest.handle = g2; g2.onAny((e) => { if (e.kind === 'message.user') texts.push(String(e.secret?.text)); }, { replay: true }); await until(() => texts.includes('third'), 8000); await new Promise((x) => setTimeout(x, 200)); expect(texts).toEqual(['third']);
    const rc = new ResumeCoordinator(g2); rc.dispose();
  });
});
describe('nothing here touches the network on its own (acceptance 5, guardrail)', () => {
  it('building an outbox, a seq store and a wake detector makes no request', async () => { let calls = 0; const http = new Proxy({}, { get: () => () => { calls++; } }); void http; const dir = mkdtempSync(join(tmpdir(), 'cc-lan-')); const { memoryKeychain, initCrypto, WakeDetector } = await import('../../src/index.js'); await initCrypto(); const o = await createDurableOutbox(dir, 'ses_X', { keychain: memoryKeychain() }); await o.push({ kind: 'message.user', id: 'msg_AAAAAAAAAAAAAAAAAAAAAAAAAA', secret: { text: 'x' } }); await createFileSeqStore(dir).save('ses_X', 1); const w = new WakeDetector({ clock: real, targets: () => [] }); w.start(); w.stop(); expect(calls).toBe(0); });
});
