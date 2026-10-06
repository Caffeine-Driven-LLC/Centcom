/** Test doubles shared by the billing, usage and flags tests: a recording logger, temp dirs, entitlement fixtures and a mock with seed data. */
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMockBackend, type MockBackend } from '@centcom/testkit';
import type { Entitlements } from '@centcom/protocol';
import { createHttpClient, type HttpClientOptions, type Logger } from '../src/index.js';
import { AutoClock, NO_TIMEOUT, UA, type Seen } from './http/helpers.js';

export const WSP = 'wsp_01JA3Z8K2M5N7P9Q0R1S2T3V4W';
export const WSP2 = 'wsp_01JA3Z8K2M5N7P9Q0R1S2T3V4X';
export const SES = 'ses_01JA3Z8K2M5N7P9Q0R1S2T3V4W';
export const AGT = 'agt_01JA3Z8K2M5N7P9Q0R1S2T3V4W';

export const tmp = (tag = 'net'): string => mkdtempSync(join(tmpdir(), `centcom-${tag}-`));

const FIX_DIR = fileURLToPath(new URL('../../../contracts/fixtures/entitlements/', import.meta.url));
export interface Fixture { name: string; valid: boolean; data: Entitlements }
export const fixtures = (): Fixture[] => readdirSync(FIX_DIR).filter((f) => f.endsWith('.json')).sort().map((f) => { const j = JSON.parse(readFileSync(join(FIX_DIR, f), 'utf8')) as { valid: boolean; data: Entitlements }; return { name: f.replace(/\.json$/, ''), valid: j.valid, data: j.data }; });
export const fixture = (name: string): Entitlements => structuredClone(fixtures().find((f) => f.name === name)!.data);

export interface LogLine { level: string; msg: string; ctx: Record<string, unknown> }
/** A Logger that keeps every line (with its bindings) for assertions. */
export function memLogger(lines: LogLine[] = [], bindings: Record<string, unknown> = {}): Logger & { lines: LogLine[] } {
  const at = (level: string) => (msg: string, ctx: Record<string, unknown> = {}) => { lines.push({ level, msg, ctx: { ...bindings, ...ctx } }); };
  return { lines, trace: at('trace'), debug: at('debug'), info: at('info'), warn: at('warn'), error: at('error'), child: (b) => memLogger(lines, { ...bindings, ...b }), flush: async () => undefined };
}

/** A mock whose entitlements come from seed data (with the generated extras neutralised), plus an HTTP client that records every request. */
export async function mockWith(ents: Entitlements[] = [], o: Partial<HttpClientOptions> & { token?: string | null } = {}) {
  const dir = tmp('seed');
  if (ents.length) writeFileSync(join(dir, 'entitlements.json'), JSON.stringify(ents.map((e) => ({ usage: {}, warnings: [], grace_until: null, ...e }))));
  const m: MockBackend = await startMockBackend({ clock: 'virtual', seed: 7, dataDir: dir });
  const seen: Seen[] = []; let token: string | undefined = o.token === null ? undefined : (o.token ?? m.mintToken({ expSeconds: 86_400 * 30 }));
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: new URL(String(input)), method: init?.method ?? 'GET', headers: Object.fromEntries(new Headers(init?.headers).entries()), body: init?.body ? new TextDecoder().decode(init.body as Uint8Array) : undefined });
    return (o.fetch ?? globalThis.fetch)(input, init);
  }) as typeof fetch;
  const http = createHttpClient({ baseUrl: m.url, getAccessToken: async () => token, userAgent: UA, clock: new AutoClock(), timeoutMs: NO_TIMEOUT, ...o, fetch: f });
  return { m, http, seen, setToken: (t: string | undefined) => { token = t; } };
}

/** Bump the mock's entitlements (rev + 1) with these fields merged in. */
export const setEntitlement = (m: MockBackend, entitlements: Record<string, unknown>, workspace = WSP) => m.control('scenario', { name: 'bump', steps: [{ do: 'set_entitlement', args: { workspace, entitlements } }] });

/** Resolve when `cond()` holds, polling on real time; fail after `ms`. */
export async function until(cond: () => boolean, ms = 1000): Promise<number> {
  const t0 = Date.now(); while (!cond()) { if (Date.now() - t0 > ms) throw new Error(`condition not met within ${ms} ms`); await new Promise((r) => setTimeout(r, 2)); }
  return Date.now() - t0;
}
