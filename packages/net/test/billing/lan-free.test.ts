import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { VirtualClock } from '@centcom/testkit';
import { EntitlementsClient, KNOWN_LIMIT_KEYS, can, limit } from '../../src/index.js';
import { WSP, tmp } from '../support.js';

/** LAN and local use never depend on entitlements, a login or the network (CT-ENTITLEMENTS §2, §5). */
describe('gates with no HTTP client at all', () => {
  const offline = (workspaceId: () => string | null = () => null) => new EntitlementsClient({ http: null, workspaceId, clock: new VirtualClock(), cacheDir: join(tmp('lan'), 'never-created') });

  it('AC5: lan_multiplayer is true with no cache, no login and no network; relay_access is false; unknown keys are "unknown"', () => {
    const c = offline();
    expect(c.can('lan_multiplayer')).toBe(true); expect(c.limit('lan_multiplayer')).toBe(true);
    expect(c.can('relay_access')).toBe(false); expect(c.can('anything_new')).toBe('unknown');
    expect(c.banner()).toEqual({ kind: 'none' }); expect(c.remaining('queue_items_month')).toBeNull();
    for (const k of KNOWN_LIMIT_KEYS) expect(typeof c.can(k)).toBe('boolean');
  });

  it('get() answers free defaults without throwing, with or without a workspace', async () => {
    for (const w of [null, WSP]) { const v = await offline(() => w).get(); expect(v).toMatchObject({ source: 'defaults', stale: true, ent: { status: 'none', plan: 'free', limits: { lan_multiplayer: true } } }); }
    await expect(offline(() => WSP).get({ force: true })).resolves.toMatchObject({ source: 'defaults' });
  });

  it('billing calls fail with a typed network error; upgradeUrl falls back to the web page', async () => {
    const c = offline(() => WSP);
    await expect(c.billing.checkout(WSP, { plan: 'pro' })).rejects.toMatchObject({ kind: 'network' });
    const it = c.billing.invoices(WSP)[Symbol.asyncIterator](); await expect(it.next()).rejects.toMatchObject({ kind: 'network' });
    expect(await c.upgradeUrl('relay_access')).toMatchObject({ via: 'fallback', url: 'https://centcom.dev/billing' });
  });

  it('the pure gates say lan_multiplayer is true whatever object they are given', () => {
    expect(can(null, 'lan_multiplayer', 0)).toBe(true); expect(can(undefined, 'lan_multiplayer', 0)).toBe(true);
    expect(limit({ limits: { lan_multiplayer: false } } as never, 'lan_multiplayer', 0)).toBe(true);
  });
});
