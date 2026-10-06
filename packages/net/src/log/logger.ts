import { redactString, redactValue } from './redact.js';

export type Level = 'trace' | 'debug' | 'info' | 'warn' | 'error';
export const LEVELS: Record<Level, number> = { trace: 10, debug: 20, info: 30, warn: 40, error: 50 };
export interface LogRecord { ts: string; level: Level; component?: string; msg: string; request_id?: string; session_id?: string; [k: string]: unknown }
export interface Sink { write(line: string, record: LogRecord): void; flush?(): Promise<void> }
export interface Bindings { component?: string; request_id?: string; session_id?: string }
export interface Logger { trace(msg: string, ctx?: Record<string, unknown>): void; debug(msg: string, ctx?: Record<string, unknown>): void; info(msg: string, ctx?: Record<string, unknown>): void; warn(msg: string, ctx?: Record<string, unknown>): void; error(msg: string, ctx?: Record<string, unknown>): void; child(b: Bindings): Logger; flush(): Promise<void> }
export const MAX_LINE = 16 * 1024;

/** 'silent' writes nothing at all. */
export type LogLevel = Level | 'silent';
export interface LoggerOptions { level: LogLevel; sinks: Sink[]; clock: () => number; home?: string; /** test hook: lets a test prove the logger fails closed when redaction breaks */ redactor?: (v: unknown, home?: string) => unknown }

const RESERVED = new Set(['ts', 'level', 'component', 'msg', 'request_id', 'session_id']);

/** One JSON object per line. The level check is the first thing that happens, so dropped records cost almost nothing. There is no option to skip redaction. */
export function createLogger(o: LoggerOptions, bindings: Bindings = {}): Logger {
  const min = o.level === 'silent' ? Infinity : LEVELS[o.level]; const redactor = o.redactor ?? redactValue;
  const emit = (level: Level, msg: string, ctx?: Record<string, unknown>) => {
    if (LEVELS[level] < min) return;
    let rec: LogRecord;
    try {
      const red = ctx ? redactor(ctx, o.home) : {}; const safe = (red && typeof red === 'object' && !Array.isArray(red) ? red : { ctx: red }) as Record<string, unknown>; const extra: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(safe ?? {})) extra[RESERVED.has(k) ? `ctx_${k}` : k] = v;
      rec = { ts: new Date(o.clock()).toISOString(), level, ...(bindings.component ? { component: bindings.component } : {}), msg: redactString(String(msg), o.home).slice(0, 200), ...(bindings.request_id ? { request_id: bindings.request_id } : {}), ...(bindings.session_id ? { session_id: bindings.session_id } : {}), ...extra };
    } catch { rec = { ts: new Date(o.clock()).toISOString(), level, msg: 'log.redaction_failed' }; } // fail closed: no context at all
    let line: string;
    try { line = JSON.stringify(rec); } catch { rec = { ts: rec.ts, level, msg: 'log.redaction_failed' }; line = JSON.stringify(rec); }
    if (line.length > MAX_LINE) { rec = { ts: rec.ts, level, ...(rec.component ? { component: rec.component } : {}), msg: rec.msg, truncated: true }; line = JSON.stringify(rec); }
    for (const s of o.sinks) { try { s.write(line, rec); } catch { /* a broken sink must never break the app */ } }
  };
  const logger: Logger = {
    trace: (m, c) => emit('trace', m, c), debug: (m, c) => emit('debug', m, c), info: (m, c) => emit('info', m, c), warn: (m, c) => emit('warn', m, c), error: (m, c) => emit('error', m, c),
    child: (b) => createLogger(o, { ...bindings, ...b }),
    async flush() { await Promise.all(o.sinks.map((s) => s.flush?.().catch(() => undefined))); },
  };
  return logger;
}
