import { revealSecret } from './create.js';
import { OVERLAP, SECRET_HIDDEN, SECRET_ONCE } from './messages.js';
import { fail, one, parseFlags, publicWebhook, usage, type Webhook, type WebhookDeps } from './common.js';
import { WEBHOOK_ID, checkEvents, checkUrl } from './validation.js';

const idOf = (f: { positional: string[] }): string | undefined => (f.positional[0] && WEBHOOK_ID.test(f.positional[0]) ? f.positional[0] : undefined);
export async function runUpdate(argv: string[], d: WebhookDeps): Promise<number> {
  const f = parseFlags(argv); if ('error' in f) return usage(d, f.error); const id = idOf(f); if (!id) return usage(d, 'Usage: centcom webhooks update <whk_id> [--url <https-url>] [--event <type> ...] [--enable|--disable]');
  const body: Record<string, unknown> = {};
  if (one(f, '--url')) { const u = checkUrl(one(f, '--url'), { allowLocalhost: f.bools.has('--allow-localhost') }); if (!u.ok) return usage(d, u.message); body.url = u.value; }
  if (f.values.has('--event')) { const e = checkEvents(f.values.get('--event')!); if (!e.ok) return usage(d, e.message); body.events = e.value; }
  if (f.bools.has('--enable') && f.bools.has('--disable')) return usage(d, 'Use either --enable or --disable, not both.'); if (f.bools.has('--enable')) body.enabled = true; if (f.bools.has('--disable')) body.enabled = false;
  if (Object.keys(body).length === 0) return usage(d, 'Nothing to change. Give --url, --event, --enable or --disable.');
  try { const w = (await d.http.call('updateWebhook', { path: { id }, body } as never)).data as unknown as Webhook; d.io.out(f.bools.has('--json') ? JSON.stringify(publicWebhook(w)) : `Updated ${w.id}.`); return 0; } catch (e) { return fail(d, e); }
}
export async function runRotate(argv: string[], d: WebhookDeps): Promise<number> {
  const f = parseFlags(argv); if ('error' in f) return usage(d, f.error); const id = idOf(f); if (!id) return usage(d, 'Usage: centcom webhooks rotate-secret <whk_id> [--show-secret]');
  try {
    const w = (await d.http.call('updateWebhook', { path: { id }, body: { rotate_secret: true } } as never)).data as unknown as Webhook; const show = revealSecret(d, f);
    if (f.bools.has('--json')) { d.io.out(JSON.stringify({ ...publicWebhook(w), overlap_hours: 24, ...(show && w.secret ? { secret: w.secret } : {}), ...(!show ? { secret_hidden: true } : {}) })); return 0; }
    d.io.out(`Rotated the signing secret of ${w.id}.`); if (show && w.secret) { d.io.out(`New signing secret: ${w.secret}`); d.io.out(SECRET_ONCE); } else d.io.out(SECRET_HIDDEN); d.io.out(OVERLAP); return 0;
  } catch (e) { return fail(d, e); }
}
export async function runDelete(argv: string[], d: WebhookDeps): Promise<number> {
  const f = parseFlags(argv); if ('error' in f) return usage(d, f.error); const id = idOf(f); if (!id) return usage(d, 'Usage: centcom webhooks delete <whk_id> [--yes]');
  if (!f.bools.has('--yes')) { if (!d.isTTY) return usage(d, 'Deleting needs confirmation. Add --yes to delete without asking.'); if (!(await d.io.confirm(`Delete webhook ${id}? Events stop immediately. [y/N] `))) { d.io.out('Cancelled. Nothing was deleted.'); return 1; } }
  try { await d.http.call('deleteWebhook', { path: { id } } as never); d.io.out(f.bools.has('--json') ? JSON.stringify({ deleted: id }) : `Deleted ${id}.`); return 0; } catch (e) { return fail(d, e); }
}
export async function runTest(argv: string[], d: WebhookDeps): Promise<number> {
  const f = parseFlags(argv); if ('error' in f) return usage(d, f.error); const id = idOf(f); if (!id) return usage(d, 'Usage: centcom webhooks test <whk_id>');
  try { const r = (await d.http.call('testWebhook', { path: { id } } as never)).data as unknown as { id?: string; status?: string } | undefined; d.io.out(f.bools.has('--json') ? JSON.stringify({ tested: id, ...(r?.id ? { delivery: r.id } : {}), ...(r?.status ? { status: r.status } : {}) }) : `Sent a webhook.test event to ${id}${r?.id ? ` (delivery ${r.id})` : ''}. Check it with: centcom webhooks deliveries ${id}`); return 0; } catch (e) { return fail(d, e); }
}
