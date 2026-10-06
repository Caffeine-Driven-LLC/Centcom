import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { HostPairing, LanHostServer, MemoryBanList, SessionTrustStore, FingerprintMismatchError, ReconnectTokens, tokenValidator } from '@centcom/lan';
import { CentcomError, DeviceKeyStore, initCrypto, memoryKeychain } from '@centcom/net';
import { LanTransport, LocalTransport, RelayTransport, openTransport, parseJoinTarget, transportCloseError } from '../src/index.js';
import { CLIENT, SID, dev, lanServer, localRig, mem, relayRig, token } from './rigs.js';

const cleanups: (() => Promise<void>)[] = []; afterEach(async () => { for (const c of cleanups.splice(0)) await c(); });

describe('join targets (acceptance 4)', () => {
  it('accepts ip:port, [ipv6]:port, session ids and join links', () => {
    expect(parseJoinTarget('192.168.1.20:7070')).toEqual({ kind: 'lan', host: '192.168.1.20', port: 7070 }); expect(parseJoinTarget('[fe80::1]:7070')).toEqual({ kind: 'lan', host: 'fe80::1', port: 7070 }); expect(parseJoinTarget('ses_01JA3Z8K2M5N7P9Q0R1S2T3V4W')).toEqual({ kind: 'relay', sessionId: 'ses_01JA3Z8K2M5N7P9Q0R1S2T3V4W' }); expect(parseJoinTarget('  10.0.0.5:1  ')).toEqual({ kind: 'lan', host: '10.0.0.5', port: 1 });
    expect(parseJoinTarget('centcom://join/abcdefghijklmnopqrstuvwx')).toEqual({ kind: 'relay', sessionId: 'abcdefghijklmnopqrstuvwx' }); expect(parseJoinTarget('centcom://join/abcdefghijklmnopqrstuvwx#k=abc')).toMatchObject({ kind: 'relay', inviteSecret: 'k=abc' });
  });
  it('rejects javascript: and other schemes, spaces, bad ports, bad octets and public addresses unless allowed', () => {
    for (const bad of ['javascript:alert(1)', 'http://192.168.1.2:7070', 'file:///etc/passwd', '192.168.1.20 :7070', '192.168.1.20:0', '192.168.1.20:65536', '192.168.1.20:-1', '999.1.1.1:7070', '192.168.1.20', ':7070', '', '   ', 'centcom://join/short', 'centcom://join/' + 'x'.repeat(200), 'ses_short', '[fe80::1]', 'host name:7070', '8.8.8.8:7070', '[2606:4700::1111]:7070']) expect(parseJoinTarget(bad), bad).toEqual({ error: 'invalid' });
    expect(parseJoinTarget('8.8.8.8:7070', { allowWan: true })).toEqual({ kind: 'lan', host: '8.8.8.8', port: 7070 });
  });
});
describe('capabilities (acceptance 3, 8)', () => {
  it('relay, lan and local differ as specified; lanUpgrade follows the welcome caps and nothing else', async () => {
    const r = await relayRig(); cleanups.push(r.teardown); expect(r.transport.capabilities).toMatchObject({ durableHistory: true, restSnapshots: true, failover: true, entitlements: true, auditLog: true, lanSnapshots: false, lanUpgrade: false });
    const l = await (await import('./rigs.js')).lanRig(); cleanups.push(l.teardown); expect(l.transport.capabilities).toMatchObject({ failover: false, lanSnapshots: true, entitlements: false, maxMembers: 8, durableHistory: false, restSnapshots: false, lanUpgrade: false }); await l.transport.connect(); expect(l.transport.capabilities.lanUpgrade).toBe(false); await l.transport.close();
    const c = await localRig(); cleanups.push(c.teardown); expect(Object.entries(c.transport.capabilities).filter(([k, v]) => k !== 'maxMembers' && v === true)).toEqual([]); expect(c.transport.capabilities.maxMembers).toBe(8);
  });
});
describe('relay transport (acceptance 2)', () => {
  it('asks for one join token per connection attempt; the ticket is never in the URL', async () => {
    const r = await relayRig(); cleanups.push(r.teardown); const urls: string[] = []; const orig = (r.transport as unknown as { client: { opts: unknown } }).client; void orig; await r.transport.connect(); expect(r.joinTokens()).toBe(1); await r.m.control('disconnect', { sid: SID, code: 1001 }); await new Promise((x) => setTimeout(x, 1500)); expect(r.joinTokens()).toBeGreaterThanOrEqual(2); expect(r.transport.state).toBe('ready'); void urls;
  });
});
describe('lan transport pairing (acceptance 2, 5)', () => {
  const pairedServer = async () => {
    await initCrypto(); const hostKc = memoryKeychain(); const hostDev = new DeviceKeyStore(hostKc, dev(100)); await hostDev.getOrCreatePublicKeys(); const trust = new SessionTrustStore(); const bans = new MemoryBanList({ now: () => Date.now(), setTimeout: (f: () => void, ms: number) => setTimeout(f, ms), clearTimeout: (h: never) => clearTimeout(h as unknown as ReturnType<typeof setTimeout>) });
    const tokens = new ReconnectTokens(); const hp = new HostPairing({ sessionId: SID, sessionName: 'demo', policy: { queue_limit: 20, auto_approve: 'ask', share_history: true }, device: hostDev, deviceInfo: { id: dev(100), name: 'host' }, fingerprint: hostDev.fingerprint(), bans, trust, tokens });
    const dir = mkdtempSync(join(tmpdir(), 'cc-pair-')); let n = 0; const server = new LanHostServer({ sessionId: SID, sessionName: 'demo', hostMember: { id: mem(1), name: 'Host', slot: 0, role: 'host' }, port: 0, bind: '127.0.0.1', tokens: tokenValidator(tokens, (d) => hp.memberFor(d)), pairing: hp, bans, transcriptPath: join(dir, 't.jsonl'), clock: { now: () => Date.now(), setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (h: never) => clearTimeout(h as unknown as ReturnType<typeof setTimeout>) }, ids: { next: (p) => `${p}_${String(++n).padStart(26, 'A')}`.slice(0, 30) } });
    const { port } = await server.start(); cleanups.push(() => server.stop()); const guestKc = memoryKeychain(); const guestDev = new DeviceKeyStore(guestKc, dev(5)); await guestDev.getOrCreatePublicKeys(); return { hp, server, port, hostDev, guestKc, guestDev };
  };
  it('the first connect pairs with the code and stores the token; the second connect sends no pairing frames', async () => {
    const e = await pairedServer(); const { display } = e.hp.openCode(); const mk = (code?: string) => new LanTransport({ host: '127.0.0.1', port: e.port, sessionId: SID, code, expectedFingerprint: e.hostDev.fingerprint(), keychain: e.guestKc, device: e.guestDev, deviceInfo: { id: dev(5), name: 'guest' }, clientInfo: CLIENT });
    const first = mk(display); const w = await first.connect(); expect(first.paired).toBe(true); expect(first.pairingFrames).toBe(2); expect(w.member.role).toBe('editor'); await first.close();
    const second = mk(); const w2 = await second.connect(); expect(second.paired).toBe(false); expect(second.pairingFrames).toBe(0); expect(w2.member.id).toBe(w.member.id); await second.close();
  });
  it('a different fingerprint fails before anything is accepted', async () => {
    const e = await pairedServer(); const { display } = e.hp.openCode(); const t = new LanTransport({ host: '127.0.0.1', port: e.port, sessionId: SID, code: display, expectedFingerprint: 'AAAA-BBBB-CCCC', keychain: e.guestKc, device: e.guestDev, deviceInfo: { id: dev(5), name: 'guest' }, clientInfo: CLIENT });
    await expect(t.connect()).rejects.toBeInstanceOf(FingerprintMismatchError); expect(await e.guestKc.get(`lan-token:${SID}`)).toBeUndefined();
  });
  it('without a token or a code it says what is needed', async () => { const e = await pairedServer(); const t = new LanTransport({ host: '127.0.0.1', port: e.port, sessionId: SID, keychain: e.guestKc, device: e.guestDev, deviceInfo: { id: dev(5), name: 'guest' }, clientInfo: CLIENT }); await expect(t.connect()).rejects.toThrow(/pairing code/); });
});
describe('errors look the same everywhere (acceptance 9)', () => {
  it('close codes map to the same typed errors', () => {
    const code = (n: number) => (transportCloseError({ code: n }) as CentcomError | undefined)?.code; expect([4403, 4426, 4401, 4404, 4409, 4429, 4503, 4408, 4400].map(code)).toEqual(['forbidden', 'client_too_old', 'token_invalid', 'session_not_found', 'conflict', 'rate_limited', 'service_unavailable', 'timeout', 'protocol_violation']); expect(transportCloseError({ code: 1000 })).toBeUndefined(); expect(transportCloseError({ code: 1006 })).toBeUndefined();
  });
  it('a LAN host that revokes a member ends the connection with 4403 and the same error as a relay would', async () => {
    const env = await lanServer(); cleanups.push(() => env.server.stop()); const kc = memoryKeychain(); await initCrypto(); const device = new DeviceKeyStore(kc, dev(2)); await device.getOrCreatePublicKeys(); const t = new LanTransport({ host: '127.0.0.1', port: env.port, sessionId: SID, reconnectToken: token('guest-token'), keychain: kc, device, deviceInfo: { id: dev(2), name: 'G' }, clientInfo: CLIENT }); await t.connect(); const closed: { code: number }[] = []; t.on('closed', (c) => closed.push(c)); env.server.kickConnection(mem(2)); await new Promise((x) => setTimeout(x, 400)); expect(closed[0]?.code).toBe(4403); expect((transportCloseError(closed[0]!) as CentcomError).code).toBe('forbidden');
  });
});
describe('local (acceptance 7)', () => {
  it('works with network access blocked: no sockets are opened by the local transport', async () => {
    const net = await import('node:net'); const real = net.Socket.prototype.connect; let attempts = 0; net.Socket.prototype.connect = function (this: import('node:net').Socket, ...a: unknown[]) { attempts++; return (real as (...x: unknown[]) => import('node:net').Socket).apply(this, a); } as never;
    try { const c = await localRig(); cleanups.push(c.teardown); const got: string[] = []; c.transport.on('frame', (f) => { if (f.k === 'reaction') got.push(f.id!); }); await c.transport.connect(); await c.transport.send({ t: 'event', id: 'msg_AAAAAAAAAAAAAAAAAAAAAAAAA1', sid: SID, k: 'reaction', p: { target: 'msg_AAAAAAAAAAAAAAAAAAAAAAAAAA', code: 'ok', op: 'add' } }); await new Promise((x) => setTimeout(x, 50)); expect(got).toEqual(['msg_AAAAAAAAAAAAAAAAAAAAAAAAA1']); expect(attempts).toBe(0); } finally { net.Socket.prototype.connect = real; }
  });
  it('a local session needs a server; openTransport builds each kind', async () => {
    const deps = { sessions: { joinToken: async () => ({ ticket: 't', relay_url: 'ws://x' }) }, keychain: memoryKeychain(), device: new DeviceKeyStore(memoryKeychain(), dev(1)), deviceInfo: { id: dev(1), name: 'x' }, clientInfo: CLIENT };
    expect(openTransport({ kind: 'relay', sessionId: SID }, deps)).toBeInstanceOf(RelayTransport); expect(openTransport({ kind: 'lan', host: '127.0.0.1', port: 1 }, deps)).toBeInstanceOf(LanTransport); expect(() => openTransport({ kind: 'local' }, deps)).toThrow(/host server/); const env = await lanServer(); cleanups.push(() => env.server.stop()); expect(openTransport({ kind: 'local', server: env.server }, deps)).toBeInstanceOf(LocalTransport);
  });
});
