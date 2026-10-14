/** The daemon's log: one JSON line per event in a file only this user can read, credentials scrubbed, the size capped (past the cap the file starts again, keeping one older copy). The runner only ever logs ids, kinds, durations and counts. */
import { appendFile, chmod, rename, stat } from 'node:fs/promises';
import { redact } from '@centcom/protocol';
import type { RunnerClock, RunnerLog } from './types.js';

export function createFileLog(o: { path: string; clock: RunnerClock; maxBytes?: number; level?: 'debug' | 'info' | 'warn' | 'error' }): RunnerLog & { flush(): Promise<void> } {
  const rank = { debug: 0, info: 1, warn: 2, error: 3 } as const; const min = rank[o.level ?? 'info']; const cap = o.maxBytes ?? 5 * 1024 * 1024; let chain: Promise<void> = Promise.resolve(); let size = -1;
  const write = (line: string) => {
    chain = chain.then(async () => {
      try {
        if (size < 0) size = await stat(o.path).then((s) => s.size, () => 0);
        if (size + line.length > cap) { await rename(o.path, o.path + '.1').catch(() => undefined); size = 0; }
        const first = size === 0; await appendFile(o.path, line, { mode: 0o600 }); if (first) await chmod(o.path, 0o600).catch(() => undefined); size += line.length;
      } catch { /* a log that cannot be written never stops the daemon */ }
    });
  };
  const at = (level: keyof typeof rank) => (msg: string, ctx?: Record<string, unknown>) => { if (rank[level] < min) return; write(redact(JSON.stringify({ ts: new Date(o.clock.now()).toISOString(), level, msg, ...(ctx ?? {}) })) + '\n'); };
  return { debug: at('debug'), info: at('info'), warn: at('warn'), error: at('error'), flush: () => chain };
}
