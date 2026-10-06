import { createAppLogger } from '@centcom/net';
import type { Logger, LogLevel } from '@centcom/net';

let shared: Logger | undefined;

/**
 * The one logger for this web server process. Every workspace logs through it (with its own child bindings),
 * so there is a single file sink on centcom.log and workspaces never rotate each other's output.
 * The log settings of the first workspace opened win; later folders' log.* values are ignored until restart.
 */
export function appLogger(cfg: { level: LogLevel; max_file_bytes: number; max_files: number }): Logger {
  shared ??= createAppLogger({ level: cfg.level, maxBytes: cfg.max_file_bytes, maxFiles: cfg.max_files }).logger;
  return shared;
}
