/** Crash reports: small redacted JSON files in the state folder, the 10 newest kept. Nothing is ever sent from here. */
import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { scrubText, type ScrubCtx } from './scrub.js';

export const MAX_REPORTS = 10; export const MAX_REPORT_BYTES = 64 * 1024; export const LOG_LINES = 50;
export interface CrashReport { v: 1; id: string; at: string; version: string; contract: string; platform: string; node: string; name: string; code?: string; message: string; stack: string[]; log: string[] }
export interface CrashInput { error: unknown; version: string; contract: string; platform: string; node: string; now: () => number; log?: string[]; scrub?: ScrubCtx }
const codeOf = (e: unknown): string | undefined => { const c = (e as { code?: unknown })?.code; return typeof c === 'string' && /^[a-z0-9_]{2,48}$/.test(c) ? c : undefined; };

export function buildReport(i: CrashInput, id: string): CrashReport {
  const e = i.error instanceof Error ? i.error : new Error(typeof i.error === 'string' ? i.error : 'non-error value thrown'); const s = i.scrub ?? {};
  const stack = (e.stack ?? '').split('\n').slice(1, 40).map((l) => scrubText(l.trim(), s).slice(0, 300));
  const r: CrashReport = { v: 1, id, at: new Date(i.now()).toISOString(), version: i.version, contract: i.contract, platform: i.platform, node: i.node, name: scrubText(e.name, s).slice(0, 80), ...(codeOf(e) ? { code: codeOf(e)! } : {}), message: scrubText(e.message, s).slice(0, 500), stack, log: (i.log ?? []).slice(-LOG_LINES).map((l) => scrubText(l, s).slice(0, 300)) };
  /* a report is bounded: cut the log, then the stack, until it fits */
  while (Buffer.byteLength(JSON.stringify(r)) > MAX_REPORT_BYTES && r.log.length) r.log.shift(); while (Buffer.byteLength(JSON.stringify(r)) > MAX_REPORT_BYTES && r.stack.length) r.stack.pop(); return r;
}
export class CrashStore {
  readonly dir: string; private seq = 0;
  constructor(stateDir: string) { this.dir = join(stateDir, 'crashes'); }
  private files(): string[] { try { return readdirSync(this.dir).filter((f) => /^[\w.-]+\.json$/.test(f)).sort(); } catch { return []; } }
  /** Writes the report (mode 0600 in a 0700 folder) and removes the oldest beyond 10. Returns its id. */
  save(i: CrashInput): CrashReport {
    mkdirSync(this.dir, { recursive: true, mode: 0o700 }); const stamp = new Date(i.now()).toISOString().replace(/[-:.]/g, '').replace('T', '-').slice(0, 19); const id = `${stamp}-${String(++this.seq).padStart(2, '0')}`; const r = buildReport(i, id);
    const tmp = join(this.dir, `.${id}.tmp`); writeFileSync(tmp, JSON.stringify(r, null, 1) + '\n', { mode: 0o600 }); renameSync(tmp, join(this.dir, `${id}.json`));
    const all = this.files(); for (const old of all.slice(0, Math.max(0, all.length - MAX_REPORTS))) rmSync(join(this.dir, old), { force: true }); return r;
  }
  list(): CrashReport[] { return this.files().map((f) => this.read(f.slice(0, -5))).filter((r): r is CrashReport => !!r).reverse(); }
  read(id: string): CrashReport | undefined { if (!/^[\w.-]+$/.test(id)) return undefined; try { const p = join(this.dir, `${id}.json`); if (statSync(p).size > MAX_REPORT_BYTES * 2) return undefined; const r = JSON.parse(readFileSync(p, 'utf8')) as CrashReport; return r?.v === 1 ? r : undefined; } catch { return undefined; } }
  delete(id: string): boolean { if (!/^[\w.-]+$/.test(id)) return false; const had = this.read(id) !== undefined; rmSync(join(this.dir, `${id}.json`), { force: true }); return had; }
  deleteAll(): number { const n = this.files().length; for (const f of this.files()) rmSync(join(this.dir, f), { force: true }); return n; }
}
