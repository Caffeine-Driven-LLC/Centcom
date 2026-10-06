import { fail, one, parseFlags, publicWebhook, table, usage, webhooksMax, workspaceOf, when, type Webhook, type WebhookDeps } from './common.js';
import { WEBHOOK_ID } from './validation.js';

export async function runList(argv: string[], d: WebhookDeps): Promise<number> {
  const f = parseFlags(argv); if ('error' in f) return usage(d, f.error);
  try {
    const ws = await workspaceOf(d, f); const all: Webhook[] = []; for await (const w of d.http.paginate('listWebhooks', { path: { id: ws } } as never, { limit: 200 })) all.push(w as unknown as Webhook);
    if (f.bools.has('--json')) { d.io.out(JSON.stringify({ webhooks: all.map(publicWebhook) })); return 0; }
    const max = await webhooksMax(d, ws);
    if (all.length === 0) d.io.out('No webhooks yet. Create one with: centcom webhooks create --url https://... --event session.created'); else for (const l of table(all.map((w) => [w.id, w.status + (w.enabled ? '' : ' (off)'), w.url, w.events.length > 2 ? `${w.events.slice(0, 2).join(', ')} +${w.events.length - 2}` : w.events.join(', ')]), ['ID', 'STATUS', 'URL', 'EVENTS'])) d.io.out(l);
    if (max !== undefined) d.io.out(`${all.length} of ${max} webhooks used on your plan.`); return 0;
  } catch (e) { return fail(d, e); }
}
export async function runShow(argv: string[], d: WebhookDeps): Promise<number> {
  const f = parseFlags(argv); if ('error' in f) return usage(d, f.error); const id = f.positional[0]; if (!id || !WEBHOOK_ID.test(id)) return usage(d, 'Usage: centcom webhooks show <whk_id> [--json]');
  try {
    const w = (await d.http.call('getWebhook', { path: { id } } as never)).data as unknown as Webhook; if (f.bools.has('--json')) { d.io.out(JSON.stringify(publicWebhook(w))); return 0; }
    d.io.out(`${w.id}  ${w.status}${w.enabled ? '' : ' (disabled)'}`); d.io.out(`  url:      ${w.url}`); d.io.out(`  events:   ${w.events.join(', ')}`); d.io.out(`  created:  ${when(w.created_at)}`); if (w.secret_rotated_at) d.io.out(`  secret rotated: ${when(w.secret_rotated_at)}${w.secret_overlap_until ? ` (old secret valid until ${when(w.secret_overlap_until)})` : ''}`); d.io.out('  The signing secret is never shown again after it was created.'); void one; return 0;
  } catch (e) { return fail(d, e); }
}
