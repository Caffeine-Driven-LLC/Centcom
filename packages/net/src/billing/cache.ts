/** Entitlements cache rules (CT-ENTITLEMENTS §6) and the on-disk copy at `<state dir>/entitlements/<wsp>.json`.
 *  Must not: store anything but the entitlements object and the time it was fetched (no tokens, no URLs, no invoices),
 *  block startup on a bad file, or build a path from anything but a valid `wsp_` id. */
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isId, validateAgainst, type Entitlements } from '@centcom/protocol';

/** Fresh for 5 minutes, then refetched. */
export const ENTITLEMENTS_TTL_MS = 5 * 60_000;
/** Offline, the last known value is still shown for 24 hours (flagged stale), then free defaults. */
export const OFFLINE_MAX_AGE_MS = 24 * 3_600_000;
/** A cache file bigger than this is ignored (an entitlements object is about 1 KiB). */
export const MAX_CACHE_FILE_BYTES = 64 * 1024;
const FILE_VERSION = 1;

export interface CachedEntitlements { ent: Entitlements; fetchedAt: number; /** the token's `ent` claim when this was fetched, so one stale token does not cause a refetch loop */ claimAtFetch?: number }
export type Freshness = 'fresh' | 'stale' | 'expired';

/** How usable a cached value is at `now`: fresh (< 5 min), stale (shown, but refetch), expired (older than 24 h: use defaults). */
export function freshness(c: Pick<CachedEntitlements, 'fetchedAt'>, now: number): Freshness {
  const age = now - c.fetchedAt;
  if (age < 0) return 'stale'; /* a clock that went backwards: refetch, but keep showing it */
  if (age <= ENTITLEMENTS_TTL_MS) return 'fresh';
  return age <= OFFLINE_MAX_AGE_MS ? 'stale' : 'expired';
}

/** Should `get()` go to the network? Yes when forced, invalidated, stale, or when the access token's `ent` claim moved past what was fetched. */
export function needsRefetch(c: CachedEntitlements | undefined, now: number, o: { force?: boolean; invalidated?: boolean; entClaim?: number } = {}): boolean {
  if (o.force || o.invalidated || !c) return true;
  if (freshness(c, now) !== 'fresh') return true;
  const claim = o.entClaim;
  return typeof claim === 'number' && claim !== c.ent.rev && claim !== c.claimAtFetch;
}

const TOP_KEYS = ['workspace', 'rev', 'plan', 'status', 'period', 'limits', 'usage', 'warnings', 'grace_until'] as const;
/** Only the contract's own top-level fields are kept, so nothing unexpected ever reaches the disk. Unknown limit keys stay (display only). */
export function pickEntitlements(e: Entitlements): Entitlements {
  const out: Record<string, unknown> = {}; for (const k of TOP_KEYS) if (e[k] !== undefined) out[k] = e[k];
  return out as Entitlements;
}

/** The per-workspace files. Every failure is swallowed: a missing or broken cache only means a refetch. */
export class EntitlementsDiskCache {
  readonly dir: string;
  /** `stateDir` is the client's state directory; files go in its `entitlements/` folder. */
  constructor(stateDir: string) { this.dir = join(stateDir, 'entitlements'); }
  private file(wsp: string): string | undefined { return isId('wsp', wsp) ? join(this.dir, `${wsp}.json`) : undefined; }

  async read(wsp: string): Promise<CachedEntitlements | undefined> {
    const f = this.file(wsp); if (!f) return undefined;
    try {
      const text = await readFile(f, 'utf8'); if (text.length > MAX_CACHE_FILE_BYTES) return undefined;
      const raw = JSON.parse(text) as { v?: unknown; fetchedAt?: unknown; ent?: unknown };
      const at = typeof raw.fetchedAt === 'string' ? Date.parse(raw.fetchedAt) : NaN;
      if (raw.v !== FILE_VERSION || !Number.isFinite(at)) return undefined;
      const v = validateAgainst('entitlements', raw.ent); if (!v.ok) return undefined;
      const ent = v.value as Entitlements; if (ent.workspace !== wsp) return undefined;
      return { ent, fetchedAt: at };
    } catch { return undefined; }
  }

  /** Atomic (temp file then rename), mode 0600 in a 0700 folder. */
  async write(wsp: string, c: CachedEntitlements): Promise<void> {
    const f = this.file(wsp); if (!f) return;
    const body = JSON.stringify({ v: FILE_VERSION, fetchedAt: new Date(c.fetchedAt).toISOString(), ent: pickEntitlements(c.ent) });
    const tmp = `${f}.${randomBytes(4).toString('hex')}.tmp`;
    try { await mkdir(this.dir, { recursive: true, mode: 0o700 }); await writeFile(tmp, body, { mode: 0o600 }); await rename(tmp, f); } catch { await rm(tmp, { force: true }).catch(() => undefined); }
  }

  async clear(wsp: string): Promise<void> { const f = this.file(wsp); if (f) await rm(f, { force: true }).catch(() => undefined); }
}
