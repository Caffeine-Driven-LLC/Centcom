/** Shared test doubles for the HTTP client: a clock that fires short timers by itself, a scripted fetch, and a mock-backend client. */
import { startMockBackend, type MockBackend } from '@centcom/testkit';
import { createHttpClient, defaultUserAgent, type HttpClientOptions, type HttpClock } from '../../src/index.js';

export const UA = defaultUserAgent('1.4.2');
export const REQ_RE = /^req_[0-9A-HJKMNP-TV-Z]{26}$/;
/** Long enough that the per-attempt timeout never fires by itself in a test that is not about timeouts. */
export const NO_TIMEOUT = 3_600_000;

/** Timers shorter than `autoBelowMs` fire on the next macrotask and move time forward; longer ones wait for fire(). Every delay is recorded. */
export class AutoClock implements HttpClock {
  t = Date.UTC(2026, 9, 6, 12, 0, 0); delays: number[] = []; private seq = 0; private timers = new Map<number, { at: number; fn: () => void }>();
  constructor(private autoBelowMs = 120_000) {}
  now() { return this.t; }
  setTimeout(fn: () => void, ms: number) {
    const id = ++this.seq; this.delays.push(ms); this.timers.set(id, { at: this.t + ms, fn });
    if (ms < this.autoBelowMs) setImmediate(() => { const tm = this.timers.get(id); if (!tm) return; this.timers.delete(id); this.t = Math.max(this.t, tm.at); tm.fn(); });
    return id;
  }
  clearTimeout(h: never) { this.timers.delete(h as unknown as number); }
  /** retry sleeps only (the per-attempt timeout timers are NO_TIMEOUT long) */
  sleeps() { return this.delays.filter((d) => d < this.autoBelowMs); }
  /** fire every pending long timer */
  fire() { const all = [...this.timers.entries()]; this.timers.clear(); for (const [, tm] of all) { this.t = Math.max(this.t, tm.at); tm.fn(); } }
  pending() { return this.timers.size; }
}

export interface Seen { url: URL; method: string; headers: Record<string, string>; body?: string }
type Step = Response | Error | ((req: Seen) => Response | Promise<Response>);

/** A fetch that answers from a script and records what it was asked. The last step repeats. */
export function scriptedFetch(steps: Step[]) {
  const seen: Seen[] = [];
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const body = init?.body === undefined || init.body === null ? undefined : typeof init.body === 'string' ? init.body : new TextDecoder().decode(init.body as Uint8Array);
    const req: Seen = { url: new URL(String(input)), method: init?.method ?? 'GET', headers, body }; seen.push(req);
    if (init?.signal?.aborted) throw init.signal.reason;
    const step = steps[Math.min(seen.length - 1, steps.length - 1)]!;
    if (step instanceof Error) throw step;
    const r = typeof step === 'function' ? await step(req) : step.clone();
    return r;
  }) as typeof fetch;
  return { fetch: f, seen };
}

export const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
export const problem = (status: number, code: string, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify({ type: `https://centcom.dev/errors/${code}`, title: code, status, code, request_id: 'req_01JA3Z8K2M5N7P9Q0R1S2T3V4W', ...extra }), { status, headers: { 'content-type': 'application/problem+json', ...headers } });

export const USER = { id: 'usr_01JA3Z8K2M5N7P9Q0R1S2T3V4W', email: 'a@example.test', display_name: 'A', created_at: '2026-10-06T12:00:00.000Z', locale: 'en', telemetry: false };
export const ME = { user: USER, active_workspace: null, ent: 1, plan: 'free' };
export const FLAGS = { flags: { 'ui.new': true }, rev: 3, ttl_s: 60 };

/** A client over a scripted fetch, with a seeded rng and the auto clock. */
export function scripted(steps: Step[], o: Partial<HttpClientOptions> = {}) {
  const s = scriptedFetch(steps); const clock = new AutoClock(); let seed = 42;
  const rng = () => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed / 2 ** 31; };
  const client = createHttpClient({ baseUrl: 'https://api.centcom.dev', getAccessToken: async () => 'tok-A', userAgent: UA, fetch: s.fetch, clock, rng, timeoutMs: NO_TIMEOUT, ...o });
  return { client, seen: s.seen, clock };
}

/** A client against the in-process mock backend, recording every request it sends. */
export async function onMock(o: Partial<HttpClientOptions> & { token?: string } = {}) {
  const m: MockBackend = await startMockBackend({ clock: 'virtual', seed: 7 });
  const seen: Seen[] = []; let token = o.token ?? m.mintToken({ expSeconds: 3600 });
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const body = init?.body ? new TextDecoder().decode(init.body as Uint8Array) : undefined;
    seen.push({ url: new URL(String(input)), method: init?.method ?? 'GET', headers, body });
    return globalThis.fetch(input, init);
  }) as typeof fetch;
  const clock = new AutoClock();
  const client = createHttpClient({ baseUrl: m.url, getAccessToken: async () => token, userAgent: UA, fetch: f, clock, timeoutMs: NO_TIMEOUT, ...o });
  return { m, client, seen, clock, setToken: (t: string) => { token = t; }, token: () => token };
}

/** The mock answers the next `count` requests with this error code. */
export const inject = (m: MockBackend, code: string, o: { count?: number; retry_after_s?: number } = {}) => m.control('errors', { code, ...o });
