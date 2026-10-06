import type { AgentWireState, ErrorCode } from '@centcom/protocol';
import { sanitize, type EventType, type Props } from './sanitize.js';

export type Env = Record<string, string | undefined>;
export interface TClock { now(): number; /** A source that never goes backwards, for measuring the gap between sends; falls back to `now`. */ monotonic?(): number; setTimeout(fn: () => void, ms: number): unknown; clearTimeout(h: never): void }
export interface StateFs { read(path: string): Promise<string | undefined>; /** Atomic, mode 0600 (and its folder 0700). */ write(path: string, text: string): Promise<void>; remove(path: string): Promise<void> }
export type HttpPost = (url: string, init: { headers: Record<string, string>; body: string; timeoutMs: number }) => Promise<{ status: number }>;
export interface TLog { debug(msg: string, ctx?: Record<string, unknown>): void }
export interface TelemetryDeps {
  config: () => { enabled: boolean }; env: Env; clock: TClock; fs: StateFs; http: HttpPost; /** A fresh ULID (26 Crockford characters) each call. */ ulid: () => string; log?: TLog; ua: string; baseUrl: string;
  /** Where `install_id` lives: `<state dir>/telemetry/install_id`. */ installIdPath: string; app?: { name: string; version: string; os: string; arch: string; contract: string }; /** The CLI's registered command names; a `command.run` for anything else is dropped. */ commands?: ReadonlySet<string>; /** The product's own feature keys; with it, `feature.used` accepts nothing else. */ features?: ReadonlySet<string>;
}
export interface TelemetryStatus { enabled: boolean; installIdPresent: boolean; buffered: number; /** Events refused by the allow-list. */ dropped: number; /** Events pushed out of the full buffer. */ overflowed: number; sentBatches: number }
export interface Telemetry {
  appStart(): void; appExit(): void; commandRun(name: string): void; sessionCreated(mode: 'command_post' | 'branch', transport: 'lan' | 'relay'): void; sessionJoined(transport: 'lan' | 'relay'): void;
  agentStateChange(from: AgentWireState, to: AgentWireState): void; featureUsed(key: string): void; errorShown(code: ErrorCode): void; perfStartup(ms: number): void; perfFrame(p95Ms: number): void; updateResult(from: string, to: string, ok: boolean): void;
  flush(deadlineMs?: number): Promise<void>; resetInstallId(): Promise<void>; status(): TelemetryStatus; dispose(): void;
}
export const MAX_BUFFER = 1000; export const MAX_BATCH = 100; export const MAX_BATCH_BYTES = 64 * 1024; export const MIN_GAP_MS = 60_000; export const SEND_TIMEOUT_MS = 5000;
const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
interface Ev { type: EventType; at: string; props?: Props }
interface Batch { key: string; events: Ev[]; attempts: number }

/** True only when the person turned it on and nothing in the environment says no. `DO_NOT_TRACK=1` and `CENTCOM_TELEMETRY=off` win over any setting. */
export const telemetryEnabled = (config: { enabled: boolean }, env: Env): boolean => config.enabled === true && env.DO_NOT_TRACK !== '1' && env.DO_NOT_TRACK?.toLowerCase() !== 'true' && env.CENTCOM_TELEMETRY?.toLowerCase() !== 'off';

export function createTelemetry(d: TelemetryDeps): Telemetry {
  let buffer: Ev[] = []; let retry: Batch | undefined; let timer: unknown; let lastSend: number | undefined; let dropped = 0; let overflowed = 0; let sent = 0; let installId: string | undefined; let idLoaded = false; let sending = false;
  const mono = () => (d.clock.monotonic ?? d.clock.now.bind(d.clock))();
  const on = () => telemetryEnabled(d.config(), d.env);
  const cancel = () => { if (timer !== undefined) d.clock.clearTimeout(timer as never); timer = undefined; };
  /** Switched off while running: nothing buffered is kept or sent. */
  const wipe = () => { buffer = []; retry = undefined; cancel(); };

  async function id(): Promise<string> {
    if (installId) return installId; if (!idLoaded) { idLoaded = true; try { const t = (await d.fs.read(d.installIdPath))?.trim(); if (t && ULID.test(t)) installId = t; } catch { d.log?.debug('telemetry.id_read_failed'); } }
    if (!installId) { installId = d.ulid(); try { await d.fs.write(d.installIdPath, installId + '\n'); } catch { d.log?.debug('telemetry.id_write_failed'); } } return installId; // an unwritable state folder: kept for this run only
  }
  function take(): Batch | undefined {
    if (retry) { const b = retry; retry = undefined; return b; } if (!buffer.length) return undefined; const events: Ev[] = []; let bytes = 400;
    while (buffer.length && events.length < MAX_BATCH) { const size = JSON.stringify(buffer[0]).length + 1; if (events.length && bytes + size > MAX_BATCH_BYTES) break; bytes += size; events.push(buffer.shift()!); }
    return { key: d.ulid(), events, attempts: 0 };
  }
  async function sendOne(): Promise<boolean> {
    const b = take(); if (!b) return false; lastSend = mono();
    try {
      const body = JSON.stringify({ install_id: await id(), ...(d.app ? { app: d.app } : {}), events: b.events }); let th: unknown; const limit = new Promise<never>((_res, rej) => { th = d.clock.setTimeout(() => rej(new Error('timeout')), SEND_TIMEOUT_MS); });
      const r = await Promise.race([d.http(`${d.baseUrl}/v1/telemetry/events`, { headers: { 'content-type': 'application/json', 'idempotency-key': b.key, 'user-agent': d.ua }, body, timeoutMs: SEND_TIMEOUT_MS }), limit]).finally(() => d.clock.clearTimeout(th as never));
      if (r.status >= 200 && r.status < 300) { sent++; return true; } throw new Error('status ' + r.status);
    } catch (e) { d.log?.debug('telemetry.send_failed', { attempt: b.attempts + 1, kind: e instanceof Error ? e.name : 'error' }); if (b.attempts < 1) retry = { ...b, attempts: b.attempts + 1 }; return true; } // once more later with the same key, then it is dropped
  }
  const gapLeft = () => (lastSend === undefined ? 0 : Math.max(0, MIN_GAP_MS - (mono() - lastSend)));
  function schedule() {
    if (timer !== undefined || (!buffer.length && !retry)) return;
    timer = d.clock.setTimeout(() => { timer = undefined; if (!on()) return wipe(); const wait = gapLeft(); if (wait > 0) return schedule(); if (sending) return; sending = true; void sendOne().finally(() => { sending = false; schedule(); }); }, gapLeft());
  }
  function emit(type: EventType, args: Record<string, unknown>) {
    const props = sanitize(type, args, { commands: d.commands, features: d.features }); if (props === undefined) { dropped++; return; }
    if (buffer.length >= MAX_BUFFER) { buffer.shift(); overflowed++; } buffer.push({ type, at: new Date(d.clock.now()).toISOString(), ...(props ? { props } : {}) }); schedule();
  }
  // Every method looks at the gate first: when telemetry is off nothing is built, stored, timed or written.
  const t: Telemetry = {
    appStart() { if (!on()) return wipeIfAny(); emit('app.start', {}); }, appExit() { if (!on()) return wipeIfAny(); emit('app.exit', {}); },
    commandRun(name) { if (!on()) return wipeIfAny(); emit('command.run', { name }); }, sessionCreated(mode, transport) { if (!on()) return wipeIfAny(); emit('session.created', { mode, transport }); }, sessionJoined(transport) { if (!on()) return wipeIfAny(); emit('session.joined', { transport }); },
    agentStateChange(from, to) { if (!on()) return wipeIfAny(); emit('agent.state_change', { from, to }); }, featureUsed(key) { if (!on()) return wipeIfAny(); emit('feature.used', { key }); }, errorShown(code) { if (!on()) return wipeIfAny(); emit('error.shown', { code }); },
    perfStartup(ms) { if (!on()) return wipeIfAny(); emit('perf.startup', { ms }); }, perfFrame(p95Ms) { if (!on()) return wipeIfAny(); emit('perf.frame', { p95_ms: p95Ms }); }, updateResult(from, to, ok) { if (!on()) return wipeIfAny(); emit('update.result', { from, to, ok }); },
    /** Sends what is allowed to go (never more often than once a minute), and always returns by the deadline. */
    flush(deadlineMs = 2000) {
      if (!on()) { wipe(); return Promise.resolve(); } cancel();
      const work = (async () => { while ((buffer.length || retry) && gapLeft() === 0 && !sending) { sending = true; try { await sendOne(); } finally { sending = false; } if (retry) break; } })().catch(() => undefined).finally(schedule); // whatever could not go yet keeps its timer
      return new Promise<void>((resolve) => { const h = d.clock.setTimeout(() => resolve(), Math.max(0, deadlineMs)); void work.then(() => { d.clock.clearTimeout(h as never); resolve(); }); });
    },
    async resetInstallId() { installId = undefined; idLoaded = true; try { await d.fs.remove(d.installIdPath); } catch { d.log?.debug('telemetry.id_remove_failed'); } installId = d.ulid(); try { await d.fs.write(d.installIdPath, installId + '\n'); } catch { d.log?.debug('telemetry.id_write_failed'); } },
    status: () => ({ enabled: on(), installIdPresent: installId !== undefined, buffered: buffer.length + (retry?.events.length ?? 0), dropped, overflowed, sentBatches: sent }),
    dispose: wipe,
  };
  function wipeIfAny() { if (buffer.length || retry || timer !== undefined) wipe(); }
  return t;
}
