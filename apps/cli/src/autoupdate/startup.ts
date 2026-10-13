/** The look for an update that happens when Centcom starts. It adds the card's rules to `bootUpdate`: not under CI, not when `update.auto` is off, at most every
 *  `update.check_interval_h` hours (with jitter), the last look kept on disk, a too-old answer remembered, and the swap done by `applyUpdate` (health check, rollback).
 *  `startUpdateCheck` returns at once; the work runs on its own and can never delay the first prompt or throw. */
import { UpdateError, type Channel, type CheckResult } from '@centcom/net';
import { bootUpdate, type BootUpdateClient, type BootUpdateResult } from '../bootUpdate.js';
import { applyUpdate } from './apply.js';
import type { InstallMethod } from './install-method.js';
import { mayAutoUpdate } from './policy.js';
import type { FsPort, Runner } from './ports.js';
import { DEFAULT_INTERVAL_H, readCheckCache, shouldCheck, writeCheckCache } from './schedule.js';
import { isTooOldSignal } from './too-old.js';

export interface StartupClient extends BootUpdateClient { paths(): { exe: string; staged: string; prev: string } }
export interface StartupDeps {
  client: StartupClient; method: InstallMethod; version: string; channel: Channel; channelChosen: boolean; platform: NodeJS.Platform;
  /** `update.check` */ check: boolean; /** `update.auto` */ auto: boolean; intervalH?: number;
  env: Record<string, string | undefined>; fs: FsPort; runner: Runner; cachePath: string; now(): number; rng(): number;
  /** Any session, host or guest, is live. */ sessionsLive(): boolean;
  say(level: 'info' | 'warn', text: string, detail?: string): void;
  /** The service answered "too old" (426, `client_too_old`, or a minimum above our version). */ onTooOld?(): void;
  /** Reports the opt-in `update.result {from, to, ok}` event, nothing else. */ onResult?(r: { from: string; to: string; ok: boolean }): void;
}
export type StartupResult = 'skipped' | BootUpdateResult;

export async function runStartupUpdate(d: StartupDeps): Promise<StartupResult> {
  if (d.env.CI || !d.check || !d.auto || /^(1|true)$/i.test(d.env.CENTCOM_NO_UPDATE_CHECK ?? '')) return 'skipped';
  const last = await readCheckCache(d.fs, d.cachePath);
  if (!shouldCheck(d.now(), last?.at ?? null, d.rng, d.intervalH ?? DEFAULT_INTERVAL_H)) return 'skipped';
  const c = d.client; let applied: { from: string; to: string } | undefined;
  const wrapped: BootUpdateClient = {
    method: c.method,
    async check(o) {
      let r: CheckResult;
      try { r = await c.check(o); } catch (e) { if (isTooOldSignal(e)) d.onTooOld?.(); throw e; }
      await writeCheckCache(d.fs, d.cachePath, { at: d.now(), channel: d.channel, ...(r.version ? { version: r.version } : {}) }); if (r.required) d.onTooOld?.();
      return r;
    },
    download: (o) => c.download(o), verify: (s) => c.verify(s),
    async apply(s) {
      const p = c.paths(); const r = await applyUpdate({ exe: p.exe, staged: p.staged, from: d.version, to: s.version, platform: d.platform, sessionsLive: d.sessionsLive }, d.fs, d.runner);
      if (r.ok) { applied = { from: r.from, to: r.to }; return { restartRequired: true, previous: r.from }; }
      d.onResult?.({ from: d.version, to: s.version, ok: false }); throw new UpdateError(r.code, r.code === 'deferred' ? 'A session is open, so the update waits for the next start.' : 'The update could not be completed and the old version is in place.');
    },
  };
  const auto = mayAutoUpdate({ auto: d.auto, method: d.method, channel: d.channel, channelChosen: d.channelChosen, ci: !!d.env.CI });
  const out = await bootUpdate({ client: wrapped, env: d.env, version: d.version, check: true, auto, say: d.say, sessionsLive: d.sessionsLive });
  if (applied) d.onResult?.({ ...applied, ok: true });
  return out;
}

/** Fire and forget: returns before any file or network is touched. Errors are swallowed (an update must never break a start). */
export function startUpdateCheck(d: StartupDeps): void { void Promise.resolve().then(() => runStartupUpdate(d)).catch(() => undefined); }
