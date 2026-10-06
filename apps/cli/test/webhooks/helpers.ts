import { createHttpClient, defaultUserAgent, type HttpClock } from '@centcom/net';
import type { WebhookDeps, WebhookIo } from '../../src/commands/webhooks/index.js';

export interface Req { method: string; url: URL; headers: Record<string, string>; body?: unknown }
export const ID = (p: string, n = 1) => `${p}_01JA3Z8K2M5N7P9Q0R1S2T3V${String(n).padStart(2, '0')}`.slice(0, 30).padEnd(30, 'X');
export const WS = 'wsp_01JA3Z8K2M5N7P9Q0R1S2T3V4W'; export const WHK = 'whk_01JA3Z8K2M5N7P9Q0R1S2T3V4W'; export const DLV = 'dlv_01JA3Z8K2M5N7P9Q0R1S2T3V4W';
export const json = (b: unknown, status = 200, h: Record<string, string> = {}) => new Response(JSON.stringify(b), { status, headers: { 'content-type': status >= 400 ? 'application/problem+json' : 'application/json', ...h } });
export const problem = (code: string, status: number, extra: Record<string, unknown> = {}) => json({ type: `https://centcom.dev/errors/${code}`, title: code, status, code, ...extra }, status);
export const webhook = (o: Record<string, unknown> = {}) => ({ id: WHK, workspace: WS, url: 'https://example.com/h', events: ['session.created'], enabled: true, status: 'active', created_at: '2026-10-05T18:07:41.123Z', ...o });
export const delivery = (o: Record<string, unknown> = {}) => ({ id: DLV, webhook: WHK, event_type: 'session.created', attempt: 1, status: 'pending', created_at: '2026-10-05T18:07:41.123Z', ...o });
export const page = (data: unknown[], next: string | null = null) => json({ data, next_cursor: next, has_more: next !== null });

class Clock implements HttpClock { t = Date.UTC(2026, 9, 7); now() { return this.t; } setTimeout(fn: () => void, ms: number) { setImmediate(() => { this.t += ms; fn(); }); return 1; } clearTimeout() {} }
/** A real HTTP client over scripted answers (the last answer repeats). */
export function rig(steps: ((r: Req) => Response)[], o: { isTTY?: boolean; stdin?: string; files?: Record<string, Uint8Array>; now?: number; confirm?: boolean } = {}) {
  const seen: Req[] = []; const out: string[] = []; const err: string[] = []; const me = (_r: Req) => json({ user: { id: 'usr_01JA3Z8K2M5N7P9Q0R1S2T3V4W', email: 'a@b.c', display_name: 'A', locale: 'en', telemetry: false, created_at: '2026-10-05T18:07:41.123Z' }, plan: 'pro', active_workspace: WS, ent: 1 });
  const fetch = (async (input: string | URL, init?: RequestInit) => { const url = new URL(String(input)); const headers = Object.fromEntries(new Headers(init?.headers).entries()); const raw = init?.body === undefined || init.body === null ? undefined : typeof init.body === 'string' ? init.body : new TextDecoder().decode(init.body as Uint8Array); const r: Req = { method: init?.method ?? 'GET', url, headers, body: raw ? JSON.parse(raw) : undefined }; seen.push(r); if (url.pathname === '/v1/me') return me(r); if (url.pathname.endsWith('/entitlements')) return json({ plan: 'pro', rev: 1, status: 'active', workspace: WS, limits: { relay_access: true, lan_multiplayer: true, max_seats: 1, max_session_members: 4, max_concurrent_sessions: 2, max_parallel_agents: 8, history_days: 7, queue_items_month: null, audit_log_days: 0, webhooks_max: 5, api_keys_max: 5, hosted_minutes_month: 6000 }, usage: { hosted_minutes_month: 0 }, period: { start: '2026-10-01T00:00:00.000Z', end: '2026-11-01T00:00:00.000Z' } }); const i = seen.filter((s) => s.url.pathname !== '/v1/me' && !s.url.pathname.endsWith('/entitlements')).length - 1; return steps[Math.min(i, steps.length - 1)]!(r); }) as typeof globalThis.fetch;
  const http = createHttpClient({ baseUrl: 'https://api.centcom.dev', getAccessToken: async () => 'tok', userAgent: defaultUserAgent('0.1.0'), fetch, clock: new Clock(), timeoutMs: 3_600_000 });
  const io: WebhookIo = { out: (l) => out.push(l), err: (l) => err.push(l), confirm: async () => o.confirm ?? true, readStdin: async () => o.stdin ?? '', readFile: async (p) => { const f = o.files?.[p]; if (!f) throw new Error('no such file'); return f; } };
  const deps: WebhookDeps = { http, io, isTTY: o.isTTY ?? true, now: () => o.now ?? Date.UTC(2026, 9, 7) };
  return { deps, seen, out, err, calls: () => seen.filter((s) => s.url.pathname !== '/v1/me' && !s.url.pathname.endsWith('/entitlements')) };
}
