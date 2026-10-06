import { SECRET_HIDDEN, SECRET_ONCE } from './messages.js';
import { fail, one, parseFlags, publicWebhook, usage, webhooksMax, workspaceOf, type Webhook, type WebhookDeps } from './common.js';
import { checkEvents, checkUrl } from './validation.js';

/** Prints a secret once: on a terminal, or when --show-secret is given. Returns the lines to show instead when it is hidden. */
export function revealSecret(d: WebhookDeps, f: { bools: Set<string> }): boolean { return d.isTTY || f.bools.has('--show-secret'); }
export async function runCreate(argv: string[], d: WebhookDeps): Promise<number> {
  const f = parseFlags(argv); if ('error' in f) return usage(d, f.error);
  const url = checkUrl(one(f, '--url'), { allowLocalhost: f.bools.has('--allow-localhost') }); if (!url.ok) return usage(d, url.message);
  const events = checkEvents(f.values.get('--event') ?? []); if (!events.ok) return usage(d, events.message);
  let max: number | undefined;
  try {
    const ws = await workspaceOf(d, f); max = await webhooksMax(d, ws);
    const body = { url: url.value, events: events.value, ...(f.bools.has('--disabled') ? { enabled: false } : {}) };
    const w = (await d.http.call('createWebhook', { path: { id: ws }, body } as never)).data as unknown as Webhook; const show = revealSecret(d, f);
    if (f.bools.has('--json')) { d.io.out(JSON.stringify({ ...publicWebhook(w), ...(show && w.secret ? { secret: w.secret } : {}), ...(!show ? { secret_hidden: true } : {}) })); return 0; }
    d.io.out(`Created ${w.id} for ${w.url}`); if (show && w.secret) { d.io.out(`Signing secret: ${w.secret}`); d.io.out(SECRET_ONCE); } else d.io.out(SECRET_HIDDEN); return 0;
  } catch (e) { return fail(d, e, { webhooksMax: max }); }
}
