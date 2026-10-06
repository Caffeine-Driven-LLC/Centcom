/** The flags cache on disk: `<state dir>/flags.json`, mode 0600. Holds the server's flags, rev, ttl, ETag and fetch time; no secrets.
 *  Must not: block on a slow disk (reads are small and synchronous only at construction), or trust a file older than 7 days or of another shape. */
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FLAG_KEY_RE } from './registry.js';

/** A disk cache older than this is ignored in favour of the registry defaults. */
export const FLAGS_CACHE_MAX_AGE_MS = 7 * 24 * 3_600_000;
export const FLAGS_CACHE_MAX_BYTES = 256 * 1024;
/** Bumped when the file's shape changes; files of another version are discarded. */
export const FLAGS_CACHE_VERSION = 1;
/** At most this many flags are kept from one answer. */
export const MAX_FLAGS = 1_000;

export interface FlagsCacheEntry { flags: Record<string, unknown>; rev: number; ttlS: number; etag?: string; fetchedAt: number }

/** Keep only well-formed keys (CT-API-FLAGS: `[a-z0-9_.-]{1,64}`) with JSON-ish values; at most MAX_FLAGS. */
export function cleanFlags(raw: unknown): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out: Record<string, unknown> = {}; let n = 0;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) { if (!FLAG_KEY_RE.test(k) || n >= MAX_FLAGS) continue; out[k] = v; n++; }
  return out;
}

export class FlagsDiskCache {
  readonly path: string;
  constructor(stateDir: string) { this.path = join(stateDir, 'flags.json'); }

  /** The cached answer if it is ours, well-formed and under 7 days old at `now`; else undefined (and a bad file is removed). */
  read(now: number): FlagsCacheEntry | undefined {
    let text: string;
    try { if (statSync(this.path).size > FLAGS_CACHE_MAX_BYTES) return undefined; text = readFileSync(this.path, 'utf8'); } catch { return undefined; }
    try {
      const r = JSON.parse(text) as { v?: unknown; flags?: unknown; rev?: unknown; ttl_s?: unknown; etag?: unknown; fetched_at?: unknown };
      const at = typeof r.fetched_at === 'string' ? Date.parse(r.fetched_at) : NaN; const flags = cleanFlags(r.flags);
      if (r.v !== FLAGS_CACHE_VERSION || !flags || !Number.isInteger(r.rev) || !Number.isInteger(r.ttl_s) || !Number.isFinite(at)) { this.remove(); return undefined; }
      if (now - at > FLAGS_CACHE_MAX_AGE_MS) return undefined;
      return { flags, rev: r.rev as number, ttlS: r.ttl_s as number, ...(typeof r.etag === 'string' && r.etag && !/[\r\n]/.test(r.etag) ? { etag: r.etag } : {}), fetchedAt: at };
    } catch { this.remove(); return undefined; }
  }

  /** Atomic write (temp file, then rename). Failures are ignored: the cache is only an optimisation. */
  write(e: FlagsCacheEntry): void {
    const tmp = `${this.path}.${randomBytes(4).toString('hex')}.tmp`;
    const text = JSON.stringify({ v: FLAGS_CACHE_VERSION, flags: e.flags, rev: e.rev, ttl_s: e.ttlS, ...(e.etag ? { etag: e.etag } : {}), fetched_at: new Date(e.fetchedAt).toISOString() });
    try { mkdirSync(join(this.path, '..'), { recursive: true, mode: 0o700 }); writeFileSync(tmp, text, { mode: 0o600 }); renameSync(tmp, this.path); } catch { try { rmSync(tmp, { force: true }); } catch { /* nothing to clean */ } }
  }

  private remove(): void { try { rmSync(this.path, { force: true }); } catch { /* unreadable folder: leave it */ } }
}
