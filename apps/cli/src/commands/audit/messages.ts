import { CentcomError, userMessage } from '@centcom/net';
export const NOT_IN_PLAN = 'The audit log is not part of your plan. Upgrade to a plan that includes it, then try again.';
export function describeError(e: unknown): { text: string; code: number } {
  if (!(e instanceof CentcomError)) return { text: 'Something went wrong. Nothing was changed that we know of.', code: 1 };
  if (['unauthorized', 'token_expired', 'token_invalid', 'token_revoked', 'device_revoked'].includes(e.code) || e.status === 401) return { text: 'You are not signed in. Run: centcom login', code: 2 };
  if (['forbidden', 'role_insufficient', 'not_a_member'].includes(e.code)) return { text: 'Reading the audit log needs an admin or owner role (and the audit:read scope). Ask a workspace admin for access.', code: 1 };
  if (['entitlement_required', 'payment_required', 'subscription_inactive'].includes(e.code)) return { text: NOT_IN_PLAN, code: 1 };
  if (e.code === 'cursor_invalid') return { text: 'The page marker expired. Run the command again.', code: 1 };
  if (e.code === 'export_not_ready') return { text: 'The export is not ready yet. Run the command again in a minute.', code: 1 };
  if (e.code === 'idempotency_conflict') return { text: 'That export request clashed with an earlier one. Wait a moment and run the command again.', code: 1 };
  const m = userMessage(e); return { text: `${m.title}${m.hint ? `. ${m.hint}` : ''}`, code: 1 };
}
