import { homedir } from 'node:os';
import { join } from 'node:path';
import { createLogger, type LogLevel, type Logger, type Sink } from './logger.js';
import { createFileSink, createRingSink, createStderrSink, nodeLogFs } from './sinks.js';

export interface AppLoggerOptions { level: LogLevel; /** where logs/ lives (default ~/.centcom) */ stateDir?: string; maxBytes?: number; maxFiles?: number; /** only for non-interactive use: a terminal UI owns the screen */ stderr?: boolean; home?: string }

/** The logger the apps use: a rotating private file, an in-memory ring for diagnostics, optionally stderr. */
export function createAppLogger(o: AppLoggerOptions): { logger: Logger; ring: ReturnType<typeof createRingSink>; file: string } {
  const dir = join(o.stateDir ?? process.env.CENTCOM_STATE_DIR ?? join(homedir(), '.centcom'), 'logs'); const ring = createRingSink(500); let warned = false;
  const sinks: Sink[] = [ring, createFileSink({ dir, maxBytes: o.maxBytes ?? 5 * 1024 * 1024, maxFiles: o.maxFiles ?? 3, fs: nodeLogFs, onUnavailable: (r) => { if (!warned) { warned = true; process.stderr.write(`log.sink_unavailable: ${r}\n`); } } })];
  if (o.stderr) sinks.push(createStderrSink());
  return { logger: createLogger({ level: o.level, sinks, clock: Date.now, home: o.home ?? homedir() }), ring, file: join(dir, 'centcom.log') };
}
