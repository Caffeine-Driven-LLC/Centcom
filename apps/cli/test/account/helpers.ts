/** Runs the account commands in-process against the mock backend: in-memory keychain, fake browser opener, recorded output and requests, virtual time. */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { vi } from 'vitest';
import { startMockBackend, type MockBackend } from '@centcom/testkit';
import { b64u } from '@centcom/protocol';
import { TokenManager, createHttpClient, createKeychainApiKeyStore, createKeychainTokenStore, defaultUserAgent, memoryKeychain, tokenSetFrom, type AuthClock, type HttpClock, type Keychain } from '@centcom/net';
import { createCommandRegistry, registerAccountCommands, type AccountDeps } from '../../src/commands/account/index.js';

/** Short timers (retry sleeps) fire on the next tick; long ones (per-attempt timeouts) never do. */
class QuickClock implements HttpClock {
  constructor(private now0: () => number) {}
  now() { return this.now0(); }
  setTimeout(fn: () => void, ms: number) { const h = { off: false }; if (ms < 120_000) setImmediate(() => { if (!h.off) fn(); }); return h; }
  clearTimeout(h: never) { (h as unknown as { off: boolean }).off = true; }
}
/** Poll timers move the mock's virtual clock, so the poller and the mock agree on the time. */
class LinkedClock implements AuthClock {
  constructor(private m: MockBackend) {}
  now() { return this.m.clock.now(); }
  setTimeout(fn: () => void, ms: number) { const h = { off: false }; setImmediate(async () => { if (h.off) return; await this.m.advance(ms); if (!h.off) fn(); }); return h; }
  clearTimeout(h: never) { (h as unknown as { off: boolean }).off = true; }
}

export interface Req { method: string; path: string; body?: Record<string, unknown>; status?: number; response?: string; auth?: string }
export const fixedKeys = { getOrCreatePublicKeys: async () => ({ x25519: b64u.encode(new Uint8Array(32).fill(3)), ed25519: b64u.encode(new Uint8Array(32).fill(4)) }) };

export interface Env {
  m: MockBackend; deps: AccountDeps; out: string[]; err: string[]; seen: Req[]; kc: Keychain & { entries: Map<string, string> }; tm: TokenManager; host: string;
  opener: ReturnType<typeof vi.fn>; ctl: { offline: boolean }; ac: AbortController;
  run(cmd: string, ...argv: string[]): Promise<number>;
  /** sign in without the command (start, approve, exchange) */
  signIn(): Promise<{ deviceId: string }>;
  stop(): Promise<void>;
}

/** One environment per test. `override` answers a request instead of the mock. */
export async function accountEnv(o: { override?: (r: Req) => Response | undefined; isTTY?: boolean; confirm?: (q: string) => Promise<boolean>; stdin?: string | null; opener?: (url: string) => Promise<boolean>; onOut?: (line: string, env: Env) => void; onRequest?: (r: Req, env: Env) => void; keychain?: Keychain & { entries: Map<string, string> } } = {}): Promise<Env> {
  const m = await startMockBackend({ clock: 'virtual', seed: 21 }); const host = new URL(m.url).host; const seen: Req[] = []; const ctl = { offline: false };
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input)); const body = init?.body ? new TextDecoder().decode(init.body as Uint8Array) : undefined;
    const r: Req = { method: init?.method ?? 'GET', path: url.pathname, body: body ? JSON.parse(body) : undefined, auth: new Headers(init?.headers).get('authorization') ?? undefined }; seen.push(r); o.onRequest?.(r, env);
    if (ctl.offline) throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    const res = o.override?.(r) ?? await globalThis.fetch(input, init); r.status = res.status; r.response = await res.clone().text(); return res;
  }) as typeof fetch;
  const http = createHttpClient({ getAccessToken: async () => undefined, baseUrl: m.url, userAgent: defaultUserAgent('0.1.0'), fetch: fetchFn, clock: new QuickClock(() => m.clock.now()), timeoutMs: 3_600_000 });
  const kc = o.keychain ?? memoryKeychain(); const lockDir = mkdtempSync(join(tmpdir(), 'centcom-acct-'));
  const tm = new TokenManager({ http, store: createKeychainTokenStore(host, { keychain: kc }), apiKeys: createKeychainApiKeyStore(host, { keychain: kc }), clock: { now: () => m.clock.now(), setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (h) => clearTimeout(h as never) }, lockDir, apiHost: host });
  const out: string[] = []; const err: string[] = []; const ac = new AbortController();
  const opener = vi.fn(o.opener ?? (async () => true));
  const env = {} as Env;
  const deps: AccountDeps = {
    http: http.withAuthProvider(tm.authProvider()), auth: tm, keys: fixedKeys, openBrowser: opener, hostname: () => 'test-host', baseUrl: m.url, clock: new LinkedClock(m), signal: ac.signal,
    io: { out: (l) => { out.push(l); o.onOut?.(l, env); }, err: (l) => { err.push(l); o.onOut?.(l, env); }, isTTY: o.isTTY ?? false },
    readLine: async () => (o.stdin === undefined ? null : o.stdin), ...(o.confirm ? { confirm: o.confirm } : {}),
  };
  const reg = createCommandRegistry(); registerAccountCommands(reg, deps);
  Object.assign(env, {
    m, deps, out, err, seen, kc, tm, host, opener, ctl, ac,
    run: async (cmd: string, ...argv: string[]) => (await reg.run(cmd, argv))!,
    async signIn() {
      const d = await http.call('startDeviceAuthorization', { body: { client_id: 'centcom-cli', device_name: 't', device_pubkeys: await fixedKeys.getOrCreatePublicKeys() } });
      await m.control('approve-device', { user_code: d.data.user_code });
      const t = await http.call('issueToken', { body: { grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: d.data.device_code, client_id: 'centcom-cli' } });
      const ts = tokenSetFrom(t.data); await tm.adopt(ts); seen.length = 0; return { deviceId: ts.deviceId };
    },
    async stop() { await m.stop().catch(() => undefined); rmSync(lockDir, { recursive: true, force: true }); },
  });
  return env;
}

export const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
export const USER_CODE_RE = /^[A-HJ-KM-NP-Z2-9]{4}-[A-HJ-KM-NP-Z2-9]{4}$/;
/** Values that must never be printed: every token, device code and key the run saw on the wire. */
export function secretsOf(seen: Req[], extra: string[] = []): string[] {
  const s = new Set(extra);
  for (const r of seen) {
    const b = (() => { try { return JSON.parse(r.response || '{}') as Record<string, unknown>; } catch { return {}; } })();
    for (const k of ['access_token', 'refresh_token', 'device_code']) if (typeof b[k] === 'string') s.add(b[k] as string);
    for (const k of ['refresh_token', 'device_code', 'token']) if (typeof r.body?.[k] === 'string') s.add(r.body[k] as string);
    if (r.auth) s.add(r.auth.replace(/^Bearer /, ''));
  }
  return [...s].filter((x) => x.length >= 8);
}
