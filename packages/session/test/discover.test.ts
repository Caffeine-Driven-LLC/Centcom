import { afterEach, describe, expect, it } from 'vitest';
import { LanAdvertiser, LanBrowser, MulticastBus, fakeInterfaces } from '@centcom/lan';
import { DeviceKeyStore, initCrypto, memoryKeychain } from '@centcom/net';
import { VirtualClock } from '@centcom/testkit';
import { discoverLanTarget, openTransport } from '../src/index.js';
import { CLIENT, SID, dev, lanServer, token } from './rigs.js';

const FP = 'ABCD-EFGH-2345'; let cleanup: (() => Promise<void>)[] = []; afterEach(async () => { for (const c of cleanup.splice(0).reverse()) await c(); });
async function lab(port: number, name = 'Fix the relay') {
  const clock = new VirtualClock(); const bus = new MulticastBus(() => clock.now());
  const adv = new LanAdvertiser({ sessionId: SID, sessionName: name, hostName: 'maya-laptop', fingerprint: FP, port, memberCount: () => 1, socketFactory: bus.factory('192.168.1.10'), clock, interfaces: () => fakeInterfaces('192.168.1.10') } as never);
  let done = false; const p = adv.start().finally(() => { done = true; }); for (let i = 0; i < 40 && !done; i++) await clock.advance(100); await p; cleanup.push(() => adv.stop());
  const browser = new LanBrowser({ socketFactory: bus.factory('192.168.1.20'), clock, interfaces: () => fakeInterfaces('192.168.1.20') });
  const find = async (match?: string) => { const p2 = discoverLanTarget(browser, { match, timeoutMs: 3000, reconnectToken: token('guest-token') }); for (let i = 0; i < 5; i++) await new Promise<void>((r) => setImmediate(r)); await clock.advance(3010); return p2; };
  return { find };
}

describe('discovery-driven LAN connect (C074)', () => {
  it('finds the host by name, takes its fingerprint, and the transport built from it connects to the real host server', async () => {
    await initCrypto(); const env = await lanServer(); cleanup.push(() => env.server.stop()); const l = await lab(env.port);
    const r = await l.find('relay'); expect(r.ok).toBe(true); if (!r.ok) return; expect(r.target).toMatchObject({ kind: 'lan', host: '192.168.1.10', port: env.port, sessionId: SID, expectedFingerprint: FP });
    const kc = memoryKeychain(); const device = new DeviceKeyStore(kc, dev(2)); await device.getOrCreatePublicKeys();
    // the advertised address is the lab's fake one; the server listens on loopback, so only the address is swapped
    const t = openTransport({ ...r.target, host: '127.0.0.1' }, { sessions: { joinToken: async () => { throw new Error('no relay'); } }, keychain: kc, device, deviceInfo: { id: dev(2), name: 'Guest' }, clientInfo: CLIENT }); cleanup.push(() => t.close());
    const w = await t.connect(); expect(w.member.id).toBeTruthy(); expect(t.kind).toBe('lan');
  });
  it('nothing matching is reported, not guessed', async () => {
    const l = await lab(7070); const r = await l.find('other session'); expect(r).toMatchObject({ ok: false, reason: 'none' });
  });
});
