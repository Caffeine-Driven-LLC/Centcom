import type { HttpClient } from '@centcom/net';
import { describeError } from './messages.js';

export interface Writer { write(chunk: Uint8Array): Promise<void>; close(): Promise<void>; /** close and remove the file */ abort(): Promise<void> }
export interface AuditFs { exists(path: string): Promise<boolean>; createWriter(path: string, mode: number): Promise<Writer> }
export interface AuditIo { out(l: string): void; err(l: string): void }
export interface AuditDeps { http: HttpClient; io: AuditIo; clock: { now(): number; sleep(ms: number, signal?: AbortSignal): Promise<void> }; fs: AuditFs; isTTY: boolean; /** for the signed download; default global fetch */ fetch?: typeof fetch; /** stop requests: wired to SIGINT by the caller */ signal?: AbortSignal }
export interface Flags { values: Map<string, string>; bools: Set<string>; positional: string[] }
const VALUE = new Set(['--workspace', '--actor', '--action', '--from', '--to', '--limit', '--format', '--out']); const BOOL = new Set(['--json', '--wait', '--force']);
export function parseFlags(argv: string[]): Flags | { error: string } {
  const f: Flags = { values: new Map(), bools: new Set(), positional: [] };
  for (let i = 0; i < argv.length; i++) { const a = argv[i]!; if (!a.startsWith('--')) { f.positional.push(a); continue; } const eq = a.indexOf('='); const k = eq > 0 ? a.slice(0, eq) : a; if (BOOL.has(k)) { f.bools.add(k); continue; } if (!VALUE.has(k)) return { error: `Unknown option ${k}.` }; const v = eq > 0 ? a.slice(eq + 1) : argv[++i]; if (v === undefined || (eq < 0 && v.startsWith('--'))) return { error: `${k} needs a value.` }; f.values.set(k, v); }
  return f;
}
export const fail = (d: AuditDeps, e: unknown): number => { const m = describeError(e); d.io.err(m.text); return m.code; };
export const usage = (d: AuditDeps, t: string): number => { d.io.err(t); return 1; };
const WSP = /^wsp_[0-9A-HJKMNP-TV-Z]{26}$/;
export async function workspaceOf(d: AuditDeps, f: Flags): Promise<string> {
  const g = f.values.get('--workspace'); if (g) { if (!WSP.test(g)) throw new Error('--workspace must look like wsp_...'); return g; }
  const me = (await d.http.call('getMe', {} as never)).data as unknown as { active_workspace: string | null }; if (!me.active_workspace) throw new Error('You have no active workspace. Pass --workspace wsp_...'); return me.active_workspace;
}
/** audit_log_days of 0 means the audit log is not part of the plan. A failed lookup is not a reason to block (the server decides). */
export async function auditAllowed(d: AuditDeps, ws: string): Promise<boolean> { try { const e = (await d.http.call('getEntitlements', { path: { id: ws } } as never)).data as unknown as { limits?: { audit_log_days?: number } }; return e.limits?.audit_log_days !== 0; } catch { return true; } }
export interface Filters { actor?: string; action?: string; from?: string; to?: string }
