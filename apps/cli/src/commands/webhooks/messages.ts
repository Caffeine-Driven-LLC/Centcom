/** Plain-language messages for what can go wrong; the secret never appears in any of them. */
import { CentcomError, userMessage } from '@centcom/net';
export function describeError(e: unknown, o: { webhooksMax?: number } = {}): { text: string; code: number } {
  if (!(e instanceof CentcomError)) return { text: 'Something went wrong. Nothing was changed that we know of.', code: 1 };
  if (['unauthorized', 'token_expired', 'token_invalid', 'token_revoked', 'device_revoked'].includes(e.code) || e.status === 401) return { text: 'You are not signed in. Run: centcom login', code: 2 };
  if (['forbidden', 'role_insufficient', 'not_a_member'].includes(e.code)) return { text: 'Only workspace admins and owners can manage webhooks. Ask an admin if you need access.', code: 1 };
  if (['entitlement_required', 'webhook_limit_reached', 'quota_exceeded', 'payment_required', 'subscription_inactive'].includes(e.code)) return { text: o.webhooksMax !== undefined ? `Your plan allows ${o.webhooksMax} webhook${o.webhooksMax === 1 ? '' : 's'} and you have reached that limit. Delete one or upgrade your plan.` : 'Your plan does not allow more webhooks. Delete one or upgrade your plan.', code: 1 };
  if (e.code === 'idempotency_conflict') return { text: 'That request clashed with an earlier one that had different contents. Wait a moment and run the command again.', code: 1 };
  if (e.code === 'webhook_url_invalid') return { text: 'The service refused that address. It must be a public https:// address.', code: 1 };
  if (e.code === 'not_found') return { text: 'That webhook or delivery was not found in this workspace.', code: 1 };
  const m = userMessage(e); return { text: `${m.title}${m.hint ? `. ${m.hint}` : ''}`, code: 1 };
}
export const SECRET_ONCE = 'This is the only time the signing secret is shown. Store it now; it cannot be retrieved later.';
export const SECRET_HIDDEN = 'The signing secret was created but is not shown here (output is not a terminal). It cannot be shown again; run "centcom webhooks rotate-secret <id> --show-secret" to get a new one.';
export const OVERLAP = 'The old secret keeps working for 24 hours, so you can switch over without dropping events.';
