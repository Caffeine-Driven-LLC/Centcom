import { beforeEach, describe, expect, it, vi } from 'vitest';
import { json, deps } from './helpers.js';

/** Each simulated tab gets its own copy of the auth modules (its own memory), but they share one lock manager, one broadcast hub and one server. */
function world() {
  let held: Promise<void> = Promise.resolve(); const locks = { request: async <T>(_n: string, cb: () => Promise<T>): Promise<T> => { const prev = held; let done!: () => void; held = new Promise<void>((r) => (done = r)); await prev; try { return await cb(); } finally { done(); } } };
  const hubs: ((m: unknown) => void)[] = []; const channel = () => { let fn: ((e: { data: unknown }) => void) | undefined; const me = (m: unknown) => fn?.({ data: m }); hubs.push(me); return { postMessage: (m: unknown) => { for (const h of hubs) if (h !== me) queueMicrotask(() => h(m)); }, addEventListener: (_t: 'message', f: (e: { data: unknown }) => void) => { fn = f; } }; };
  let refreshes = 0; const server = async (url: string): Promise<Response> => { if (url.endsWith('/v1/auth/token')) { refreshes++; await new Promise((r) => setTimeout(r, 20)); return json(200, { access_token: `AT-${refreshes}`, expires_in: 900 }); } return json(404, {}); };
  async function tab() { vi.resetModules(); const store = await import('../../src/auth/store.js'); const refresh = await import('../../src/auth/refresh.js'); const d = deps(server, { locks, channel: channel() as never }); refresh.listen(d, () => undefined); return { store, refresh, d }; }
  return { tab, refreshes: () => refreshes };
}
beforeEach(() => vi.resetModules());
describe('single flight across tabs (acceptance 5)', () => {
  it('two tabs that expire together cause exactly one refresh request and both end with the same token', async () => {
    const w = world(); const a = await w.tab(); const b = await w.tab(); const [ta, tb] = await Promise.all([a.refresh.getAccessToken(a.d), b.refresh.getAccessToken(b.d)]); expect(w.refreshes()).toBe(1); expect(ta).toBe('AT-1'); expect(tb).toBe('AT-1'); expect(a.store.peekToken().token).toBe('AT-1'); expect(b.store.peekToken().token).toBe('AT-1');
  });
  it('calls inside one tab share one request too, and a token with time left is used without any request', async () => {
    const w = world(); const a = await w.tab(); const [x, y, z] = await Promise.all([a.refresh.getAccessToken(a.d), a.refresh.getAccessToken(a.d), a.refresh.getAccessToken(a.d)]); expect(new Set([x, y, z]).size).toBe(1); expect(w.refreshes()).toBe(1); expect(await a.refresh.getAccessToken(a.d)).toBe('AT-1'); expect(w.refreshes()).toBe(1);
  });
  it('less than 60 s left refreshes; 61 s does not; the request carries the web header, credentials and no refresh token', async () => {
    const w = world(); const a = await w.tab(); a.store.setToken('OLD', 120, 1_000_000); a.d.now = () => 1_000_000 + 60_001; expect(await a.refresh.getAccessToken(a.d)).toBe('AT-1'); a.store.setToken('FRESH', 900, 1_000_000); a.d.now = () => 1_000_000; expect(await a.refresh.getAccessToken(a.d)).toBe('FRESH');
    const call = a.d.calls[0]!; expect((call.init!.headers as Record<string, string>)['X-Centcom-Client']).toBe('web'); expect(call.init!.credentials).toBe('include'); expect(String(call.init!.body)).not.toMatch(/refresh_token":"/); expect(call.url).not.toContain('refresh');
  });
});
