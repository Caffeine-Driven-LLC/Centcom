import { fail, one, parseFlags, table, usage, when, type WebhookDeps } from './common.js';
import { DELIVERY_ID, WEBHOOK_ID } from './validation.js';

interface Delivery { id: string; webhook: string; event_type: string; attempt: number; status: string; created_at: string; response_status?: number | null; duration_ms?: number | null; next_attempt_at?: string | null }
export async function runDeliveries(argv: string[], d: WebhookDeps): Promise<number> {
  const f = parseFlags(argv); if ('error' in f) return usage(d, f.error); const id = f.positional[0]; if (!id || !WEBHOOK_ID.test(id)) return usage(d, 'Usage: centcom webhooks deliveries <whk_id> [--limit n] [--json]');
  const lim = one(f, '--limit'); const limit = lim === undefined ? 50 : Number(lim); if (!Number.isInteger(limit) || limit < 1 || limit > 200) return usage(d, '--limit must be a whole number from 1 to 200.');
  try {
    const rows: Delivery[] = []; for await (const x of d.http.paginate('listWebhookDeliveries', { path: { id } } as never, { limit: Math.min(limit, 200) })) { rows.push(x as unknown as Delivery); if (rows.length >= limit) break; }
    if (f.bools.has('--json')) { d.io.out(JSON.stringify({ deliveries: rows })); return 0; }
    if (rows.length === 0) { d.io.out('No deliveries yet.'); return 0; } for (const l of table(rows.map((r) => [r.id, r.event_type, String(r.attempt), r.status + (r.response_status ? ` (${r.response_status})` : ''), when(r.created_at)]), ['ID', 'EVENT', 'ATTEMPT', 'STATUS', 'TIME'])) d.io.out(l); return 0;
  } catch (e) { return fail(d, e); }
}
export async function runRedeliver(argv: string[], d: WebhookDeps): Promise<number> {
  const f = parseFlags(argv); if ('error' in f) return usage(d, f.error); const [id, dlv] = f.positional; if (!id || !WEBHOOK_ID.test(id) || !dlv || !DELIVERY_ID.test(dlv)) return usage(d, 'Usage: centcom webhooks redeliver <whk_id> <dlv_id>');
  try { const r = (await d.http.call('redeliverWebhook', { path: { id, dlv } } as never)).data as unknown as { attempt?: number; id?: string } | undefined; d.io.out(f.bools.has('--json') ? JSON.stringify({ redelivered: dlv, ...(r?.attempt !== undefined ? { attempt: r.attempt } : {}) }) : `Queued another attempt for ${dlv}${r?.attempt !== undefined ? ` (attempt ${r.attempt})` : ''}.`); return 0; } catch (e) { return fail(d, e); }
}
