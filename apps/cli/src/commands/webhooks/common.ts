import type { HttpClient } from '@centcom/net';
import { describeError } from './messages.js';
import { WORKSPACE_ID } from './validation.js';

export interface WebhookIo { out(l: string): void; err(l: string): void; confirm(q: string): Promise<boolean>; readStdin(): Promise<string>; readFile(path: string): Promise<Uint8Array> }
export interface WebhookDeps { http: HttpClient; io: WebhookIo; isTTY: boolean; now?: () => number }
export interface Flags { positional: string[]; values: Map<string, string[]>; bools: Set<string> }
const VALUE_FLAGS = new Set(['--workspace', '--url', '--event', '--limit', '--signature', '--body-file', '--tolerance']); const BOOL_FLAGS = new Set(['--json', '--yes', '--show-secret', '--allow-localhost', '--disabled', '--enable', '--disable', '--secret-stdin', '--rotate-secret']);
export function parseFlags(argv: string[]): Flags | { error: string } {
  const f: Flags = { positional: [], values: new Map(), bools: new Set() };
  for (let i = 0; i < argv.length; i++) { const a = argv[i]!; if (a.startsWith('--')) { const eq = a.indexOf('='); const k = eq > 0 ? a.slice(0, eq) : a; if (BOOL_FLAGS.has(k)) { f.bools.add(k); continue; } if (!VALUE_FLAGS.has(k)) return { error: `Unknown option ${k}.` }; const v = eq > 0 ? a.slice(eq + 1) : argv[++i]; if (v === undefined || (eq < 0 && v.startsWith('--'))) return { error: `${k} needs a value.` }; f.values.set(k, [...(f.values.get(k) ?? []), v]); } else f.positional.push(a); }
  return f;
}
export const one = (f: Flags, k: string): string | undefined => f.values.get(k)?.at(-1);
export const fail = (d: WebhookDeps, e: unknown, o: { webhooksMax?: number } = {}): number => { const m = describeError(e, o); d.io.err(m.text); return m.code; };
export const usage = (d: WebhookDeps, text: string): number => { d.io.err(text); return 1; };
/** `--workspace` or the active workspace from /v1/me. */
export async function workspaceOf(d: WebhookDeps, f: Flags): Promise<string> {
  const given = one(f, '--workspace'); if (given) { if (!WORKSPACE_ID.test(given)) throw new Error('--workspace must look like wsp_...'); return given; }
  const me = (await d.http.call('getMe', {} as never)).data as unknown as { active_workspace: string | null }; if (!me.active_workspace) throw new Error('You have no active workspace. Pass --workspace wsp_...'); return me.active_workspace;
}
export async function webhooksMax(d: WebhookDeps, ws: string): Promise<number | undefined> { try { const e = (await d.http.call('getEntitlements', { path: { id: ws } } as never)).data as unknown as { limits?: { webhooks_max?: number } }; return e.limits?.webhooks_max; } catch { return undefined; } }
export const when = (iso: string | null | undefined): string => (iso ? iso.replace('T', ' ').replace(/\.\d+Z$/, 'Z') : '-');
export function table(rows: string[][], head: string[]): string[] { const w = head.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length))); const line = (r: string[]) => r.map((c, i) => c.padEnd(w[i]!)).join('  ').trimEnd(); return [line(head), ...rows.map(line)]; }
export interface Webhook { id: string; workspace: string; url: string; events: string[]; enabled: boolean; status: string; created_at: string; secret_overlap_until?: string | null; secret_rotated_at?: string | null; secret?: string }
/** The shape printed with --json: never the secret. */
export const publicWebhook = (w: Webhook): Omit<Webhook, 'secret'> => { const { secret: _s, ...rest } = w; void _s; return rest; };
