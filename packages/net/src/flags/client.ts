/** The feature flags client (lane C067): `GET /v1/flags` with ETag revalidation, an in-memory and on-disk cache, typed reads with safe
 *  defaults, local developer overrides and `flags-changed` events.
 *  Must not: make startup or any command wait on the network (every fetch is in the background and bounded at 2 s), send anything
 *  identifying beyond the bearer token when logged in, honour overrides in a stable build without CENTCOM_DEV=1, or decide anything
 *  about security (sandbox, permissions, crypto) from a flag. */
import { CentcomError } from '../errors/index.js';
import type { HttpClient, HttpClock } from '../http/types.js';
import type { Logger } from '../log/index.js';
import { FlagsDiskCache, cleanFlags, type FlagsCacheEntry } from './cache.js';
import { FLAGS_CONFIG_KEY, resolveOverrides } from './overrides.js';
import { FLAG_DEFS, typed, type FlagDef, type FlagDefs, type FlagRegistry, type FlagValue } from './registry.js';

export const MIN_TTL_S = 30;
export const MAX_TTL_S = 3_600;
/** Every refresh gives up after this long (the cache or the defaults stay). */
export const REFRESH_TIMEOUT_MS = 2_000;
/** After a failure the next try is this far away (at most once a minute). */
export const FAILURE_RETRY_MS = 60_000;

export interface FlagsChange { added: string[]; removed: string[]; changed: string[] }
export interface FlagsSnapshot { flags: Record<string, unknown>; rev: number | null; fetchedAt: string | null; source: 'defaults' | 'cache' | 'network' }
/** Login, logout and claim changes from the C052 token manager (any subset). Each one triggers a refresh. */
export interface FlagsAuthEvents { on(ev: 'login' | 'logout' | 'ent-changed' | 'plan-changed', fn: () => void): () => void }
export interface FlagsClientOptions<R> {
  http: HttpClient;
  /** the state directory; the cache is `flags.json` in it */
  cacheDir: string;
  clock: HttpClock;
  config: { get(key: string): unknown };
  env: Record<string, string | undefined>;
  isDevBuild: boolean;
  logger?: Logger;
  auth?: FlagsAuthEvents;
  /** default: the shipped FLAG_DEFS */
  registry?: FlagDefs<R>;
}

/** Clamp a server ttl to [30 s, 3600 s]. */
export const clampTtlS = (t: number): number => Math.min(MAX_TTL_S, Math.max(MIN_TTL_S, Number.isFinite(t) ? Math.floor(t) : MIN_TTL_S));

export class FlagsClient<R extends object = FlagRegistry> {
  private state: { flags: Record<string, unknown>; rev: number | null; etag?: string; fetchedAt: number | null; source: FlagsSnapshot['source'] };
  private readonly disk: FlagsDiskCache; private readonly defs: Record<string, FlagDef>; private readonly log?: Logger;
  private readonly listeners = new Set<(d: FlagsChange) => void>();
  private overrides: Record<string, FlagValue> = {}; private warnedIgnored = false; private readonly warnedType = new Set<string>();
  private timer: unknown; private running?: Promise<void>; private started = false; private unsubs: (() => void)[] = []; private ttlS?: number;

  constructor(private readonly o: FlagsClientOptions<R>) {
    this.log = o.logger?.child({ component: 'flags' }); this.defs = (o.registry ?? FLAG_DEFS) as unknown as Record<string, FlagDef>;
    this.disk = new FlagsDiskCache(o.cacheDir);
    const c = this.disk.read(o.clock.now());
    this.state = c ? { flags: c.flags, rev: c.rev, ...(c.etag ? { etag: c.etag } : {}), fetchedAt: c.fetchedAt, source: 'cache' } : { flags: {}, rev: null, fetchedAt: null, source: 'defaults' };
    if (c) this.ttlS = clampTtlS(c.ttlS);
    this.loadOverrides();
  }

  /** Start the background refresh (bounded at 2 s) and its timer. Returns at once: nothing here waits for the network. */
  start(): void {
    if (this.started) return; this.started = true;
    const a = this.o.auth; if (a) for (const ev of ['login', 'logout', 'ent-changed', 'plan-changed'] as const) { try { this.unsubs.push(a.on(ev, () => this.authChanged())); } catch { /* this auth source has no such event */ } }
    void this.refresh();
  }
  /** Stop the timer and the auth listeners. */
  stop(): void { this.started = false; this.cancel(); this.unsubs.forEach((u) => u()); this.unsubs = []; }

  /** Login, logout, or the `ent`/`plan` claim changed: refresh now (the flags are evaluated per caller). */
  authChanged(): void { void this.refresh(); }

  /** One GET (with If-None-Match when an ETag is known). Concurrent calls share one request. Never throws. */
  refresh(): Promise<void> {
    this.running ??= this.doRefresh().finally(() => { this.running = undefined; });
    return this.running;
  }

  private async doRefresh(): Promise<void> {
    const { clock } = this.o; const ac = new AbortController(); const t = clock.setTimeout(() => ac.abort(new Error('timeout')), REFRESH_TIMEOUT_MS);
    let next = FAILURE_RETRY_MS;
    try {
      const etag = this.state.etag;
      if (etag) {
        const r = await this.o.http.revalidate('getFlags', {}, etag, { signal: ac.signal });
        if (r.notModified) { this.state = { ...this.state, fetchedAt: clock.now(), source: 'network' }; next = clampTtlS(this.ttlS ?? MIN_TTL_S) * 1000; this.save(); return; }
        next = this.apply(r.data, r.etag) * 1000;
      } else {
        const r = await this.o.http.call('getFlags', {}, { signal: ac.signal });
        next = this.apply(r.data, r.etag) * 1000;
      }
    } catch (e) {
      this.log?.debug('flags.refresh_failed', { code: e instanceof CentcomError ? e.code : undefined, kind: e instanceof CentcomError ? e.kind : undefined });
    } finally { clock.clearTimeout(t as never); this.schedule(next); }
  }

  /** Take a 200 answer: keep well-formed keys, diff, emit, save. Returns the clamped ttl in seconds. A malformed body keeps the old values. */
  private apply(data: unknown, etag: string | undefined): number {
    const b = data as { flags?: unknown; rev?: unknown; ttl_s?: unknown } | undefined; const flags = cleanFlags(b?.flags);
    if (!flags || !Number.isInteger(b?.rev) || typeof b?.ttl_s !== 'number') { this.log?.debug('flags.malformed'); return FAILURE_RETRY_MS / 1000; }
    const ttl = clampTtlS(b.ttl_s); this.ttlS = ttl;
    const before = this.state.flags; const d = diff(before, flags);
    this.state = { flags, rev: b.rev as number, ...(etag && !/[\r\n]/.test(etag) ? { etag } : {}), fetchedAt: this.o.clock.now(), source: 'network' };
    this.warnedType.clear(); this.save();
    if (d.added.length || d.removed.length || d.changed.length) this.emit(d);
    return ttl;
  }

  private save(): void {
    const s = this.state; if (s.rev === null || s.fetchedAt === null) return;
    const e: FlagsCacheEntry = { flags: s.flags, rev: s.rev, ttlS: this.ttlS ?? MIN_TTL_S, ...(s.etag ? { etag: s.etag } : {}), fetchedAt: s.fetchedAt };
    this.disk.write(e);
  }
  private schedule(ms: number): void {
    this.cancel(); if (!this.started) return;
    this.timer = this.o.clock.setTimeout(() => { this.timer = undefined; void this.refresh(); }, ms);
  }
  private cancel(): void { if (this.timer !== undefined) this.o.clock.clearTimeout(this.timer as never); this.timer = undefined; }

  /** The flag's value: a local override (dev only), else the server's value if it has the registry type, else the registry default. Never waits. */
  flag<K extends keyof R & string>(key: K): R[K] {
    const def = Object.hasOwn(this.defs, key) ? this.defs[key] : undefined;
    if (!def) throw new TypeError(`flag "${key}" is not in the registry`);
    if (Object.hasOwn(this.overrides, key)) return this.overrides[key] as R[K];
    if (Object.hasOwn(this.state.flags, key)) {
      const v = typed(def, this.state.flags[key]); if (v !== undefined) return v as R[K];
      if (!this.warnedType.has(key)) { this.warnedType.add(key); this.log?.debug('flags.wrong_type', { key, want: def.type }); }
    }
    return def.default as R[K];
  }

  /** Everything the server sent (unknown keys too), the rev, when it was fetched and where it came from. */
  snapshot(): FlagsSnapshot {
    const s = this.state; return { flags: { ...s.flags }, rev: s.rev, fetchedAt: s.fetchedAt === null ? null : new Date(s.fetchedAt).toISOString(), source: s.source };
  }

  /** `flags-changed` fires with the keys added, removed and changed by a refresh. Returns an unsubscribe. */
  on(ev: 'flags-changed', fn: (d: FlagsChange) => void): () => void { if (ev !== 'flags-changed') throw new TypeError(`unknown event ${String(ev)}`); this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  private emit(d: FlagsChange): void { for (const fn of [...this.listeners]) { try { fn(d); } catch { /* a listener's bug must not stop the others */ } } }

  /** Read the overrides again (after a config change). */
  loadOverrides(): void {
    let cfg: unknown; try { cfg = this.o.config.get(FLAGS_CONFIG_KEY); } catch { cfg = undefined; }
    const r = resolveOverrides({ defs: this.defs, config: cfg, env: this.o.env, isDevBuild: this.o.isDevBuild });
    if (r.ignored && !this.warnedIgnored) { this.warnedIgnored = true; this.log?.warn('flags.overrides_ignored', { reason: 'stable build without CENTCOM_DEV=1' }); }
    if (r.unknown.length) this.log?.debug('flags.overrides_unknown', { count: r.unknown.length });
    this.overrides = r.values;
  }
}

function diff(a: Record<string, unknown>, b: Record<string, unknown>): FlagsChange {
  const added: string[] = []; const removed: string[] = []; const changed: string[] = [];
  for (const k of Object.keys(b)) { if (!Object.hasOwn(a, k)) added.push(k); else if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) changed.push(k); }
  for (const k of Object.keys(a)) if (!Object.hasOwn(b, k)) removed.push(k);
  return { added, removed, changed };
}
