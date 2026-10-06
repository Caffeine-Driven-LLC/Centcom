import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LanHostServer } from '@centcom/lan';
import { DeviceKeyStore, createHttpClient, defaultUserAgent, initCrypto, memoryKeychain, type ClientIdent } from '@centcom/net';
import { startMockBackend } from '@centcom/testkit';
import { LanTransport, LocalTransport, RelayTransport } from '../src/index.js';
import type { ConformanceRig } from '../src/transport/conformance.js';

export const SID = 'ses_01JA3Z8K2M5N7P9Q0R1S2T3V4W'; export const CLIENT: ClientIdent = { name: 'centcom-cli', version: '1.0.0', contract: '1.2.0' };
export const mem = (n: number) => `mem_${String(n).padStart(26, 'A')}`.slice(0, 30); export const dev = (n: number) => `dev_${String(n).padStart(26, 'A')}`.slice(0, 30); export const token = (s: string) => s.padEnd(43, '_');
export async function lanServer(o: { tokens?: Map<string, { memberId: string; deviceId: string; name: string; role: 'host' | 'editor' | 'viewer' }> } = {}) {
  const tokens = o.tokens ?? new Map([[token('guest-token'), { memberId: mem(2), deviceId: dev(2), name: 'Guest', role: 'editor' as const }]]); const dir = mkdtempSync(join(tmpdir(), 'cc-session-')); let n = 0;
  const server = new LanHostServer({ sessionId: SID, sessionName: 'demo', hostMember: { id: mem(1), name: 'Host', slot: 0, role: 'host' }, port: 0, bind: '127.0.0.1', tokens: { validate: async (t) => tokens.get(t) ?? null }, transcriptPath: join(dir, 't.jsonl'), clock: { now: () => Date.now(), setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (h: never) => clearTimeout(h as unknown as ReturnType<typeof setTimeout>) }, ids: { next: (p) => `${p}_${String(++n).padStart(26, 'A')}`.slice(0, 30) } });
  const { port } = await server.start(); return { server, port, tokens, dir };
}
export async function relayRig(): Promise<ConformanceRig & { m: Awaited<ReturnType<typeof startMockBackend>>; joinTokens(): number }> {
  const m = await startMockBackend({ clock: 'virtual', seed: 7 }); const token = m.mintToken({ expSeconds: 86_400 }); const http = createHttpClient({ baseUrl: m.url, getAccessToken: async () => token, userAgent: defaultUserAgent('1.0.0'), timeoutMs: 3_600_000 }); const rest = { joinToken: async (id: string, caps?: string[]) => (await http.call('createJoinToken', { path: { id }, body: caps ? { caps } : {} } as never)).data as unknown as { ticket: string; relay_url: string } };
  const mk = (last: number | null) => new RelayTransport({ sessionId: SID, sessions: rest, clientInfo: CLIENT, relayUrl: m.wsUrl, allowPlainWs: true, getLastSeq: () => last }); let mkCount = 0;
  const first = mk(null); mkCount++; return { transport: first, m, joinTokens: () => first.joinTokens, again: async (last: number | null) => { mkCount++; return mk(last); }, teardown: async () => { await first.close().catch(() => undefined); await m.stop(); void mkCount; } };
}
export async function lanRig(): Promise<ConformanceRig & { env: Awaited<ReturnType<typeof lanServer>> }> {
  await initCrypto(); const env = await lanServer(); const kc = memoryKeychain(); const device = new DeviceKeyStore(kc, dev(2)); await device.getOrCreatePublicKeys();
  const mk = (last: number | null) => new LanTransport({ host: '127.0.0.1', port: env.port, sessionId: SID, reconnectToken: token('guest-token'), keychain: kc, device, deviceInfo: { id: dev(2), name: 'Guest' }, clientInfo: CLIENT, getLastSeq: () => last });
  return { transport: mk(null), env, again: async (last: number | null) => mk(last), teardown: async () => { await env.server.stop(); } };
}
export async function localRig(): Promise<ConformanceRig & { env: Awaited<ReturnType<typeof lanServer>> }> {
  const env = await lanServer(); return { transport: new LocalTransport(env.server), env, again: async (last: number | null) => new LocalTransport(env.server, () => last), teardown: async () => { await env.server.stop(); } };
}
