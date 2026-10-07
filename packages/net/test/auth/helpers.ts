/** Test doubles for the auth client: a clock tied to the mock's virtual clock, a recording client against the mock, a fixed-key DeviceKeyProvider, and a quick sign-in. */
import { startMockBackend, type MockBackend } from '@centcom/testkit';
import { b64u } from '@centcom/protocol';
import { createHttpClient, tokenSetFrom, type AuthClock, type AuthDeviceKeyProvider, type HttpClient, type TokenSet } from '../../src/index.js';
import { AutoClock, NO_TIMEOUT, UA } from '../http/helpers.js';

/** Timers fire by moving the mock's virtual clock, so the poller and the mock agree on what time it is. One setImmediate per timer. */
export class LinkedClock implements AuthClock {
  private live = new Set<{ cancelled: boolean }>();
  constructor(private m: MockBackend) {}
  now() { return this.m.clock.now(); }
  setTimeout(fn: () => void, ms: number) {
    const h = { cancelled: false }; this.live.add(h);
    setImmediate(async () => { if (h.cancelled) return; await this.m.advance(ms); if (h.cancelled) return; this.live.delete(h); fn(); });
    return h;
  }
  clearTimeout(h: never) { const x = h as unknown as { cancelled: boolean }; x.cancelled = true; this.live.delete(x); }
  /** timers set and neither fired nor cleared */
  pending() { return this.live.size; }
}

export interface Rec { method: string; path: string; body?: Record<string, unknown>; status?: number; response?: string; t: number; auth?: string }
const parse = (s: string | undefined): Record<string, unknown> | undefined => { if (!s) return undefined; try { return JSON.parse(s) as Record<string, unknown>; } catch { return undefined; } };

/** A recording fetch in front of the mock. `override` answers a request instead of the mock; `offline` makes every request fail like a dead network. */
export function recordingFetch(m: MockBackend | undefined, o: { override?: (r: Rec) => Response | undefined; time?: () => number } = {}) {
  const seen: Rec[] = []; const ctl = { offline: false };
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input)); const body = init?.body ? new TextDecoder().decode(init.body as Uint8Array) : undefined;
    const rec: Rec = { method: init?.method ?? 'GET', path: url.pathname, body: parse(body), t: o.time?.() ?? m?.clock.now() ?? 0, auth: new Headers(init?.headers).get('authorization') ?? undefined }; seen.push(rec);
    if (ctl.offline) throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    const res = o.override?.(rec) ?? await globalThis.fetch(input, init);
    rec.status = res.status; rec.response = await res.clone().text(); return res;
  }) as typeof fetch;
  return { fetch: f, seen, ctl };
}

/** A public (no identity) HTTP client against the mock, recording every request with mock time. */
export async function authMock(o: { override?: (r: Rec) => Response | undefined } = {}) {
  const m = await startMockBackend({ clock: 'virtual', seed: 11 });
  const r = recordingFetch(m, o);
  const http = createHttpClient({ getAccessToken: async () => undefined, baseUrl: m.url, userAgent: UA, fetch: r.fetch, clock: new AutoClock(), timeoutMs: NO_TIMEOUT });
  return { m, http, seen: r.seen, ctl: r.ctl, clock: new LinkedClock(m), host: new URL(m.url).host };
}

/** Two fixed 32-byte public keys (a stub DeviceKeyProvider). */
export const fixedKeys: AuthDeviceKeyProvider = { getOrCreatePublicKeys: async () => ({ x25519: b64u.encode(new Uint8Array(32).fill(7)), ed25519: b64u.encode(new Uint8Array(32).fill(9)) }) };

/** Sign in against the mock without polling: start, approve, exchange. */
export async function mockSignIn(m: MockBackend, http: HttpClient): Promise<TokenSet & { deviceCode: string }> {
  const d = await http.call('startDeviceAuthorization', { body: { client_id: 'centcom-cli', device_name: 'test', device_pubkeys: await fixedKeys.getOrCreatePublicKeys() } });
  await m.control('approve-device', { user_code: d.data.user_code });
  const t = await http.call('issueToken', { body: { grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: d.data.device_code, client_id: 'centcom-cli' } });
  return { ...tokenSetFrom(t.data), deviceCode: d.data.device_code };
}

/** An unsigned JWT with these claims (the client decodes, never verifies). */
export const fakeJwt = (claims: Record<string, unknown>) => `${b64u.encode(new TextEncoder().encode(JSON.stringify({ alg: 'EdDSA', typ: 'at+jwt' })))}.${b64u.encode(new TextEncoder().encode(JSON.stringify(claims)))}.${b64u.encode(new Uint8Array(64))}`;
export const DEV = 'dev_01JA3Z8K2M5N7P9Q0R1S2T3V4W';
export const USR = 'usr_01JA3Z8K2M5N7P9Q0R1S2T3V4W';
/** A TokenResponse body for scripted fetches. */
export const tokenBody = (access: string, refresh: string) => ({ access_token: access, token_type: 'Bearer', expires_in: 900, refresh_token: refresh, scope: 'profile', device: DEV, user: USR });
