import { ulid, errCode, errStatus, failure, Pager, type Http } from '../workspace/data.js';
export { ulid };
export interface Webhook { id: string; url: string; events: string[]; enabled: boolean; status: string; created_at: string; secret_rotated_at?: string | null; secret_overlap_until?: string | null }
export interface Delivery { id: string; event_type: string; attempt: number; status: string; response_status?: number | null; duration_ms?: number | null; created_at: string; next_attempt_at?: string | null }
export interface AuditEvent { id: string; at: string; actor: string; action: string; target?: string | null; result?: string | null; metadata?: Record<string, unknown> | null }
/** `https` only; `http://localhost` and loopback only when the workspace is in test mode. */
export function validateUrl(raw: string, o: { testMode?: boolean } = {}): string | undefined {
  let u: URL; try { u = new URL(raw.trim()); } catch { return 'Enter a full address, like https://example.com/hooks.'; } if (u.username || u.password) return 'Leave the user name and password out of the address.';
  if (u.protocol === 'https:') return undefined; if (u.protocol === 'http:' && o.testMode && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)) return undefined; return 'The address must start with https://.';
}
/** The signing secret lives here while its modal is open and nowhere else: not in storage, not in the URL, not in a log. */
export class SecretVault { private s: string | undefined; reveal(secret: string): void { this.s = secret; } get(): string | undefined { return this.s; } get open(): boolean { return this.s !== undefined; } clear(): void { this.s = undefined; } }
export type Res<T = unknown> = ({ ok: true } & T) | { ok: false; reason: string; retryAfterS?: number; message?: string };
const fail = (e: unknown): { ok: false; reason: string; retryAfterS?: number } => ({ ok: false, ...failure(e) });
export async function createWebhook(http: Http, ws: string, input: { url: string; events: string[] }, vault: SecretVault, key: string): Promise<Res<{ webhook: Webhook }>> {
  const bad = validateUrl(input.url); if (bad) return { ok: false, reason: 'invalid', message: bad }; if (!input.events.length) return { ok: false, reason: 'invalid', message: 'Pick at least one event.' };
  try { const r = await http.call('createWebhook', { id: ws, body: { url: input.url.trim(), events: input.events } }, { idempotencyKey: key }); const d = r.data as Webhook & { secret?: string }; if (d.secret) vault.reveal(d.secret); const { secret: _s, ...webhook } = d; void _s; return { ok: true, webhook }; } catch (e) { return e && (errCode(e) === 'webhooks_limit_reached' || errStatus(e) === 402) ? { ok: false, reason: 'limit' } : fail(e); }
}
export async function rotateSecret(http: Http, id: string, vault: SecretVault): Promise<Res<{ overlapUntil?: string | null }>> { try { const r = await http.call('updateWebhook', { id, body: { rotate_secret: true } }); const d = r.data as Webhook & { secret?: string }; if (d.secret) vault.reveal(d.secret); return { ok: true, overlapUntil: d.secret_overlap_until }; } catch (e) { return fail(e); } }
export async function updateWebhook(http: Http, id: string, patch: { url?: string; events?: string[]; enabled?: boolean }): Promise<Res<{ webhook: Webhook }>> { if (patch.url !== undefined) { const bad = validateUrl(patch.url); if (bad) return { ok: false, reason: 'invalid', message: bad }; } try { const r = await http.call('updateWebhook', { id, body: patch }); return { ok: true, webhook: r.data as Webhook }; } catch (e) { return fail(e); } }
export async function deleteWebhook(http: Http, id: string): Promise<Res> { try { await http.call('deleteWebhook', { id }); return { ok: true }; } catch (e) { return fail(e); } }
/** A test delivery: if the endpoint does not answer in 10 s the delivery is shown as `timeout` with the retry schedule. */
export async function testWebhook(http: Http, id: string, timeoutMs = 10_000): Promise<Res<{ delivery: Delivery }>> {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), timeoutMs);
  try { const r = await http.call('testWebhook', { id }, { signal: ac.signal }); return { ok: true, delivery: r.data as Delivery }; } catch (e) { if (ac.signal.aborted) return { ok: true, delivery: { id: 'test', event_type: 'test', attempt: 1, status: 'timeout', created_at: new Date().toISOString() } }; return fail(e); } finally { clearTimeout(t); }
}
export const deliveriesPager = (http: Http, id: string): Pager<Delivery> => new Pager<Delivery>((cursor, limit) => http.listPage('listWebhookDeliveries', { id, limit, ...(cursor ? { cursor } : {}) }) as never);
export async function redeliver(http: Http, id: string, dlv: string, key: string = ulid()): Promise<Res> { try { await http.call('redeliverWebhook', { id, dlv }, { idempotencyKey: key }); return { ok: true }; } catch (e) { return fail(e); } }
/* ------------------------------------------------------------- audit */
export interface AuditFilter { actor?: string; action?: string; from?: string; to?: string }
const KEYS = ['actor', 'action', 'from', 'to'] as const;
export const filterToQuery = (f: AuditFilter): string => { const q = new URLSearchParams(); for (const k of KEYS) if (f[k]) q.set(k, f[k]!); return q.toString(); };
export const filterFromQuery = (q: string | URLSearchParams): AuditFilter => { const p = typeof q === 'string' ? new URLSearchParams(q) : q; const f: AuditFilter = {}; for (const k of KEYS) { const v = p.get(k); if (v) f[k] = v.slice(0, 200); } return f; };
export const auditPager = (http: Http, ws: string, f: AuditFilter): Pager<AuditEvent> => new Pager<AuditEvent>((cursor, limit) => http.listPage('listAuditEvents', { id: ws, limit, ...f, ...(cursor ? { cursor } : {}) }) as never);
export interface AuditExport { id: string; status: 'pending' | 'ready' | 'failed' | 'expired'; download_url?: string | null }
export type ExportOutcome = { state: 'ready'; url: string } | { state: 'failed' } | { state: 'timeout' };
/** Creates the export and polls every 3 s for at most 2 minutes. */
export async function runExport(http: Http, ws: string, body: { format: 'csv' | 'json' } & AuditFilter, o: { sleep(ms: number): Promise<void>; now(): number; everyMs?: number; maxMs?: number; onTick?(n: number): void }): Promise<ExportOutcome> {
  const made = await http.call('createAuditExport', { id: ws, body }, { idempotencyKey: ulid() }); const id = (made.data as AuditExport).id; const t0 = o.now(); let n = 0;
  for (;;) { const r = (await http.call('getAuditExport', { id: ws, exp: id })).data as AuditExport; if (r.status === 'ready' && r.download_url) return { state: 'ready', url: r.download_url }; if (r.status === 'failed' || r.status === 'expired') return { state: 'failed' }; if (o.now() - t0 >= (o.maxMs ?? 120_000)) return { state: 'timeout' }; o.onTick?.(++n); await o.sleep(o.everyMs ?? 3000); }
}
/** Audit details are text, cut at 500 characters. */
export const detailText = (m: unknown, expanded = false): { text: string; cut: boolean } => { const t = m === undefined || m === null ? '' : typeof m === 'string' ? m : JSON.stringify(m); return t.length > 500 && !expanded ? { text: t.slice(0, 500) + '…', cut: true } : { text: t, cut: false }; };
export interface Ent { limits?: { webhooks_max?: number; audit_log_days?: number } }
/** What the plan allows: `webhooks_max` of 0 or `audit_log_days` of 0 means the feature is off. */
export const entitlementState = (e: Ent | undefined): { webhooksMax: number | undefined; auditDays: number | undefined; webhooksOff: boolean; auditOff: boolean } => ({ webhooksMax: e?.limits?.webhooks_max, auditDays: e?.limits?.audit_log_days, webhooksOff: e?.limits?.webhooks_max === 0, auditOff: e?.limits?.audit_log_days === 0 });
