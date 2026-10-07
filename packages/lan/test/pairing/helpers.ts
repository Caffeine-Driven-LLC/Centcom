/** Shared setup for the pairing tests: C056 device keys on an in-memory keychain, a virtual clock, a captured log, and in-memory channels. */
import { DeviceKeyStore, createLogger, initCrypto, memoryKeychain } from '@centcom/net';
import { VirtualClock } from '@centcom/testkit';
import { guestPair, HostPairing, memoryChannelPair, MemoryBanList, SessionTrustStore, type TextChannel } from '../../src/index.js';

export const SID = 'ses_01JA3Z8K2M5N7P9Q0R1S2T3V4W';
export const HOST_DEV = 'dev_01JA3Z8K2M5N7P9Q0R1S2T3V4H';
export const GUEST_DEV = 'dev_01JA3Z8K2M5N7P9Q0R1S2T3V4G';
export const POLICY = { queue_limit: 20, auto_approve: 'ask' as const, share_history: true };

export async function deviceKeys(id: string) { await initCrypto(); const kc = memoryKeychain(); const d = new DeviceKeyStore(kc, id); await d.getOrCreatePublicKeys(); return { d, kc }; }

/** A channel that records every frame sent through it. */
export function tap(ch: TextChannel, out: string[]): TextChannel { return { ...ch, send: (t) => { out.push(t); ch.send(t); }, onMessage: (f) => ch.onMessage(f), onClose: (f) => ch.onClose(f), close: (c) => ch.close(c) }; }

export async function setup() {
  const clock = new VirtualClock(); const logs: string[] = [];
  const logger = createLogger({ level: 'trace', sinks: [{ write: (l) => logs.push(l) }], clock: () => clock.now() });
  const host = await deviceKeys(HOST_DEV); const guest = await deviceKeys(GUEST_DEV);
  const bans = new MemoryBanList(clock); const trust = new SessionTrustStore();
  const hp = new HostPairing({ sessionId: SID, sessionName: 'Fix the relay', policy: POLICY, device: host.d, deviceInfo: { id: HOST_DEV, name: 'maya-laptop' }, fingerprint: host.d.fingerprint(), clock, bans, trust, logger });
  const paired: unknown[] = []; const failed: { ip: string; reason: string }[] = [];
  hp.on('paired', (g) => paired.push(g)); hp.on('failed', (f) => failed.push(f));
  const { display } = hp.openCode();
  const hostSent: string[] = []; const guestSent: string[] = []; const closes: number[] = [];
  /** One guest connection: returns the guestPair promise plus the raw channels. */
  const connect = (o: { code?: string; ip?: string; device?: DeviceKeyStore; deviceId?: string; expectedFingerprint?: string; keychain?: ReturnType<typeof memoryKeychain> } = {}) => {
    const [g, h] = memoryChannelPair(); h.onClose((c) => closes.push(c));
    hp.attach(tap(h, hostSent), o.ip ?? '192.168.1.20');
    const p = guestPair({ channel: tap(g, guestSent), code: o.code ?? display, device: o.device ?? guest.d, deviceInfo: { id: o.deviceId ?? GUEST_DEV, name: 'ana-desktop' }, hostSessionId: SID, expectedFingerprint: o.expectedFingerprint ?? host.d.fingerprint(), clock, keychain: o.keychain ?? guest.kc });
    return { p, g, h };
  };
  return { clock, logs, host, guest, bans, trust, hp, paired, failed, display, connect, hostSent, guestSent, closes, logger };
}

/** A code that is valid but not the right one. */
export const wrongCode = (display: string) => (display[0] === 'A' ? 'B' : 'A') + display.slice(1);
