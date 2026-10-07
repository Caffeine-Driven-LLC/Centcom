/** The local message table: the service sends keys (`notif.<category>.title`) and ids/enums; the words live here.
 *  `{name}` is replaced from `params`, but only with ids and short plain values (see render.ts). */
export const CATEGORIES = ['approval_needed', 'queue_turn', 'mention', 'member_joined', 'member_left', 'agent_done', 'ci_failed', 'pr_merged', 'usage_warning', 'quota_reached', 'billing_issue', 'invite_received', 'update_available', 'security_alert'] as const;
export type Category = (typeof CATEGORIES)[number];

export const GENERIC_TITLE = 'Centcom'; export const GENERIC_BODY = 'You have a new notification.';

const table: Record<string, string> = {
  'notif.approval_needed.title': 'An agent needs your approval', 'notif.approval_needed.body': 'Agent {agent} is waiting for a yes or no (risk: {risk}).',
  'notif.queue_turn.title': 'It is your turn', 'notif.queue_turn.body': 'Your message is next in the session queue.',
  'notif.mention.title': 'You were mentioned', 'notif.mention.body': '{member} mentioned you in a session.',
  'notif.member_joined.title': 'Someone joined', 'notif.member_joined.body': '{member} joined the session.',
  'notif.member_left.title': 'Someone left', 'notif.member_left.body': '{member} left the session.',
  'notif.agent_done.title': 'An agent finished', 'notif.agent_done.body': 'Agent {agent} is done.',
  'notif.ci_failed.title': 'A check failed', 'notif.ci_failed.body': 'A check failed on {branch}.',
  'notif.pr_merged.title': 'A pull request was merged', 'notif.pr_merged.body': 'Pull request {pr} was merged.',
  'notif.usage_warning.title': 'You are close to your limit', 'notif.usage_warning.body': 'You have used {percent}% of your {meter} allowance.',
  'notif.quota_reached.title': 'You reached your limit', 'notif.quota_reached.body': 'Your {meter} allowance is used up.',
  'notif.billing_issue.title': 'There is a problem with your billing', 'notif.billing_issue.body': 'Open Centcom billing to fix it.',
  'notif.invite_received.title': 'You were invited', 'notif.invite_received.body': 'You have a new workspace invite.',
  'notif.update_available.title': 'An update is available', 'notif.update_available.body': 'Version {version} of Centcom is available.',
  'notif.security_alert.title': 'Security alert', 'notif.security_alert.body': 'Something needs your attention on your account.',
  'notif.action.open_session': 'Open session',
};
const extra: Record<string, string> = {};
export const lookup = (key: string): string | undefined => extra[key] ?? table[key];
/** Add or replace entries (a locale pack, or a feature's own keys). Only keys starting with `notif.` are taken. */
export function registerMessages(t: Record<string, string>): void { for (const [k, v] of Object.entries(t)) if (/^notif\.[a-z0-9_.]+$/.test(k) && typeof v === 'string') extra[k] = v; }
export const resetMessages = (): void => { for (const k of Object.keys(extra)) delete extra[k]; };
