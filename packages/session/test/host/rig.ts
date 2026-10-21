/** A host engine on a loopback LAN server with real guest transports, shared by the host tests that need more than the first e2e file. */
import { join } from 'node:path';
import { afterEach } from 'vitest';
import { ReconnectTokens } from '@centcom/lan';
import { DeviceKeyStore, initCrypto, memoryKeychain } from '@centcom/net';
import { HostSessionEngine, LanTransport, createFilePersistence, type EngineOptions } from '../../src/index.js';
import { CLIENT, SID, dev, lanServer, mem, token } from '../rigs.js';

const stops: (() => Promise<void>)[] = [];
export const onStop = (f: () => Promise<void>): void => { stops.push(f); };
export function cleanup(): void { afterEach(async () => { for (const s of stops.splice(0).reverse()) await s().catch(() => undefined); }); }
export const wait = async (f: () => boolean, ms = 4000): Promise<void> => { const t0 = Date.now(); while (!f()) { if (Date.now() - t0 > ms) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 10)); } };
export const realClock = { now: () => Date.now(), setTimeout: (f: () => void, ms: number) => setTimeout(f, ms), clearTimeout: (h: never) => clearTimeout(h as unknown as ReturnType<typeof setTimeout>) };
export const ID = (n: number): string => `msg_${String(n).padStart(26, 'A')}`.slice(0, 30);
let seqN = 1000; export const nextId = (): string => ID(++seqN);
export const que = (s: string): string => `que_${s.padEnd(26, 'A')}`.slice(0, 30);
export const submit = (item: string, size = 10): never => ({ t: 'queue', k: 'queue.submit', id: nextId(), sid: SID, p: { item, size, kind: 'message' } }) as never;
export const ctl = (k: string, p: Record<string, unknown>): never => ({ t: k.startsWith('queue.') ? 'queue' : 'control', k, id: nextId(), sid: SID, p }) as never;

export type Got = { k?: string; p?: Record<string, unknown>; from?: unknown; seq?: number; ct?: { c: string }; id?: string; t?: string };
/** Members: the host (mem 1, dev 1, token 'host'), editors 'g1' (mem 2), 'g2' (mem 3), a viewer 'g3' (mem 4). The host is a socket here, so it can drop. */
export async function setup(o: { policy?: Record<string, unknown>; engine?: Partial<EngineOptions>; server?: Record<string, unknown> } = {}) {
  await initCrypto();
  const tokens = new Map([[token('host'), { memberId: mem(1), deviceId: dev(1), name: 'Host', role: 'host' as const }], [token('g1'), { memberId: mem(2), deviceId: dev(2), name: 'G1', role: 'editor' as const }], [token('g2'), { memberId: mem(3), deviceId: dev(3), name: 'G2', role: 'editor' as const }], [token('g3'), { memberId: mem(4), deviceId: dev(4), name: 'V', role: 'viewer' as const }]]);
  const env = await lanServer({ tokens, ...(o.server ? { server: o.server } : {}) }); const rec = new ReconnectTokens(); const persistence = createFilePersistence(join(env.dir, 'hist'));
  const engine = new HostSessionEngine({ server: env.server, persistence, tokens: rec, clock: realClock, policy: o.policy ?? {}, snapshotBuilder: async () => new Uint8Array([1, 2, 3]), ...o.engine }); await engine.start(); onStop(() => engine.stop());
  const guest = async (name: string, n: number, last: number | null = null) => {
    const kc = memoryKeychain(); const device = new DeviceKeyStore(kc, dev(n)); await device.getOrCreatePublicKeys();
    const t = new LanTransport({ host: '127.0.0.1', port: env.port, sessionId: SID, reconnectToken: token(name), keychain: kc, device, deviceInfo: { id: dev(n), name }, clientInfo: CLIENT, getLastSeq: () => last });
    const got: Got[] = []; const errs: string[] = []; const closes: number[] = []; t.on('frame', (f) => got.push(f as never)); t.on('error', (e: unknown) => errs.push(String((e as { code?: string }).code ?? e))); t.on('closed', (c: { code: number }) => closes.push(c.code));
    await t.connect(); onStop(() => t.close()); return { t, got, errs, closes, ofKind: (k: string) => got.filter((f) => f.k === k) };
  };
  return { env, engine, guest, rec, persistence };
}
