import { createHttpClient, defaultUserAgent, type HttpClock } from '@centcom/net';
import type { AuditDeps, AuditFs, Writer } from '../../src/commands/audit/index.js';

export interface Req { method: string; url: URL; headers: Record<string, string>; body?: unknown }
export const WS = 'wsp_01JA3Z8K2M5N7P9Q0R1S2T3V4W'; export const EXP = 'exp_01JA3Z8K2M5N7P9Q0R1S2T3V4W';
export const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': status >= 400 ? 'application/problem+json' : 'application/json' } });
export const problem = (code: string, status: number, extra: Record<string, unknown> = {}) => json({ type: `https://centcom.dev/errors/${code}`, title: code, status, code, ...extra }, status);
export const ev = (n: number, o: Record<string, unknown> = {}) => ({ id: `aud_01JA3Z8K2M5N7P9Q0R1S2T3V${String(n % 100).padStart(2, '0')}`, workspace: WS, at: new Date(Date.UTC(2026, 9, 5, 18, 0, n % 60)).toISOString(), actor: { type: 'user', id: 'usr_01JA3Z8K2M5N7P9Q0R1S2T3V4W' }, action: 'member.removed', target: { type: 'member', id: 'mem_1' }, result: 'allowed', ...o });
export const page = (data: unknown[], next: string | null = null) => json({ data, next_cursor: next, has_more: next !== null });
export const job = (status: string, o: Record<string, unknown> = {}) => ({ id: EXP, status, format: 'csv', created_at: '2026-10-07T00:00:00.000Z', download_url: status === 'ready' ? 'https://downloads.centcom.dev/x?sig=SECRETSIG' : null, expires_at: null, ...o });

export class FakeClock { t = Date.UTC(2026, 9, 7, 12); sleeps: number[] = []; now() { return this.t; } async sleep(ms: number) { this.sleeps.push(ms); this.t += ms; }
  // for the HTTP client
  setTimeout(fn: () => void, ms: number) { setImmediate(() => { this.t += ms; fn(); }); return 1; } clearTimeout() {} }
export function memFs(existing: string[] = []) {
  const files = new Map<string, { data: Buffer; mode: number }>(); for (const e of existing) files.set(e, { data: Buffer.from('OLD'), mode: 0o644 }); const events: string[] = [];
  const fs: AuditFs = { exists: async (p) => files.has(p), async createWriter(path, mode): Promise<Writer> { const parts: Buffer[] = []; files.set(path, { data: Buffer.alloc(0), mode }); events.push(`open ${path}`); return { write: async (c) => { parts.push(Buffer.from(c)); files.set(path, { data: Buffer.concat(parts), mode }); }, close: async () => { events.push(`close ${path}`); }, abort: async () => { files.delete(path); events.push(`abort ${path}`); } }; } };
  return { fs, files, events };
}
export function rig(steps: ((r: Req) => Response)[], o: { existing?: string[]; download?: (url: string) => Response; entitlementDays?: number; isTTY?: boolean; signal?: AbortSignal } = {}) {
  const seen: Req[] = []; const out: string[] = []; const err: string[] = []; const clock = new FakeClock(); const m = memFs(o.existing);
  const fetch = (async (input: string | URL, init?: RequestInit) => { const url = new URL(String(input)); const headers = Object.fromEntries(new Headers(init?.headers).entries()); const raw = init?.body === undefined || init.body === null ? undefined : typeof init.body === 'string' ? init.body : new TextDecoder().decode(init.body as Uint8Array); const r: Req = { method: init?.method ?? 'GET', url, headers, body: raw ? JSON.parse(raw) : undefined }; seen.push(r);
    if (url.pathname === '/v1/me') return json({ user: { id: 'usr_01JA3Z8K2M5N7P9Q0R1S2T3V4W', email: 'a@b.c', display_name: 'A', locale: 'en', telemetry: false, created_at: '2026-10-05T18:07:41.123Z' }, plan: 'team', active_workspace: WS, ent: 1 });
    if (url.pathname.endsWith('/entitlements')) return json({ plan: 'team', rev: 1, status: 'active', workspace: WS, limits: { relay_access: true, lan_multiplayer: true, max_seats: 5, max_session_members: 8, max_concurrent_sessions: 4, max_parallel_agents: 8, history_days: 30, queue_items_month: null, audit_log_days: o.entitlementDays ?? 90, webhooks_max: 5, api_keys_max: 5, hosted_minutes_month: null }, usage: { hosted_minutes_month: 0 }, period: { start: '2026-10-01T00:00:00.000Z', end: '2026-11-01T00:00:00.000Z' } });
    const i = seen.filter((s) => !['/v1/me'].includes(s.url.pathname) && !s.url.pathname.endsWith('/entitlements')).length - 1; return steps[Math.min(i, steps.length - 1)]!(r); }) as typeof globalThis.fetch;
  const http = createHttpClient({ baseUrl: 'https://api.centcom.dev', getAccessToken: async () => 'BEARER-TOKEN-123456', userAgent: defaultUserAgent('0.1.0'), fetch, clock, timeoutMs: 3_600_000 });
  const downloads: string[] = []; const dl = (async (url: string) => { downloads.push(url); return o.download ? o.download(url) : new Response('a,b\n1,2\n'); }) as unknown as typeof globalThis.fetch;
  const deps: AuditDeps = { http, io: { out: (l) => out.push(l), err: (l) => err.push(l) }, clock, fs: m.fs, isTTY: o.isTTY ?? true, fetch: dl, signal: o.signal };
  const calls = () => seen.filter((s) => s.url.pathname !== '/v1/me' && !s.url.pathname.endsWith('/entitlements'));
  return { deps, seen, out, err, clock, files: m.files, events: m.events, calls, downloads };
}
