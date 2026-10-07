/** Catches what nobody caught: writes a report, tells the person where it is and how to see it, and ends the process. Never sends anything. */
import type { CrashStore } from './report.js';
import type { CrashInput } from './report.js';

export interface CrashDeps { store: CrashStore; proc: { on(e: string, f: (...a: unknown[]) => void): unknown; off(e: string, f: (...a: unknown[]) => void): unknown; exit(code: number): never | void }; info: Omit<CrashInput, 'error' | 'log'>; recentLog: () => string[]; err: (l: string) => void; /** At most once per process, with the code only (telemetry's `error.shown`). */ onCode?: (code: string) => void }
export function installCrashHandlers(d: CrashDeps): () => void {
  let handling = false; let emitted = false;
  const handle = (error: unknown) => {
    if (handling) return; handling = true;
    try { const r = d.store.save({ ...d.info, error, log: d.recentLog() }); if (r.code && !emitted) { emitted = true; try { d.onCode?.(r.code); } catch { /* telemetry never blocks a crash report */ } } d.err(`Centcom stopped unexpectedly. A report without any of your code or messages was saved: centcom crash show ${r.id}`); }
    catch { d.err('Centcom stopped unexpectedly, and the crash report could not be saved.'); }
    d.proc.exit(1);
  };
  const a = (e: unknown) => handle(e); const b = (e: unknown) => handle(e);
  d.proc.on('uncaughtException', a); d.proc.on('unhandledRejection', b);
  return () => { d.proc.off('uncaughtException', a); d.proc.off('unhandledRejection', b); };
}
