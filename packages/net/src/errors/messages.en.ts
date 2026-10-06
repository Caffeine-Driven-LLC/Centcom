import type { ErrorCode } from '@centcom/protocol';

export interface Msg { title: string; hint?: string }

/** Record<ErrorCode, ...>: adding a code to the contract without a message here is a compile error. */
export const MESSAGES: Record<ErrorCode, Msg> = {
  // generic
  invalid_request: { title: 'That request was not valid', hint: 'Update Centcom and try again. If it keeps happening, report it with the reference below.' },
  validation_failed: { title: 'Some details are not valid', hint: 'Check the highlighted fields and try again.' },
  payload_too_large: { title: 'That is too large to send', hint: 'Send less at once, for example a smaller file or a shorter message.' },
  unsupported_media_type: { title: 'Centcom sent data in a format the server does not accept', hint: 'Update Centcom to the latest version.' },
  not_found: { title: 'That could not be found', hint: 'It may have been deleted or you may not have access.' },
  conflict: { title: 'That changed while you were working', hint: 'Reload and try again.' },
  gone: { title: 'That is no longer available' },
  precondition_failed: { title: 'That was changed by someone else first', hint: 'Reload to see the latest version, then try again.' },
  cursor_invalid: { title: 'This list expired', hint: 'Reload it from the start.' },
  idempotency_key_required: { title: 'Centcom could not safely send that', hint: 'Update Centcom to the latest version.' },
  idempotency_conflict: { title: 'That request clashed with an earlier one', hint: 'Wait a moment and try again.' },
  rate_limited: { title: 'Too many requests', hint: 'Slow down for a moment. Centcom will try again for you.' },
  internal_error: { title: 'Something went wrong on the server', hint: 'This is not your fault. Try again in a minute.' },
  bad_gateway: { title: 'The server is not answering properly', hint: 'Try again in a minute.' },
  service_unavailable: { title: 'The service is temporarily unavailable', hint: 'Try again in a minute. Local and LAN work are not affected.' },
  timeout: { title: 'The server took too long to answer', hint: 'Check your connection and try again.' },
  // auth
  unauthorized: { title: 'You need to sign in', hint: 'Run centcom login.' },
  token_expired: { title: 'Your sign-in expired', hint: 'Centcom will refresh it. If that fails, run centcom login.' },
  token_invalid: { title: 'Your sign-in is not valid', hint: 'Run centcom login to sign in again.' },
  token_revoked: { title: 'This sign-in was ended', hint: 'Run centcom login to sign in again.' },
  device_revoked: { title: 'This device was removed from your account', hint: 'Run centcom login to add it again.' },
  refresh_reuse_detected: { title: 'This sign-in was ended for your safety', hint: 'Its token was used twice, which can mean it was copied. Run centcom login, and check your devices in your account.' },
  invalid_client: { title: 'The server does not recognise this app', hint: 'Update Centcom to the latest version.' },
  invalid_grant: { title: 'That sign-in code is not valid', hint: 'Start the sign-in again.' },
  invalid_scope: { title: 'Centcom asked for access the server does not offer', hint: 'Update Centcom to the latest version.' },
  expired_token: { title: 'The sign-in code expired', hint: 'Start the sign-in again and finish it within a few minutes.' },
  access_denied: { title: 'Sign-in was cancelled', hint: 'You declined the request. Start again if that was a mistake.' },
  authorization_pending: { title: 'Waiting for you to finish signing in', hint: 'Complete the sign-in in your browser.' },
  slow_down: { title: 'Checking too often', hint: 'Centcom will check less often.' },
  // authorisation
  forbidden: { title: 'You do not have permission to do that', hint: 'Ask a workspace owner or admin if you need access.' },
  not_a_member: { title: 'You are not a member of this workspace', hint: 'Ask for an invite.' },
  role_insufficient: { title: 'Your role cannot do that', hint: 'Ask an owner or admin to change your role or do it for you.' },
  owner_required: { title: 'Only the workspace owner can do that' },
  // billing
  payment_required: { title: 'Payment is needed', hint: 'Update your billing details to continue.' },
  entitlement_required: { title: 'Your plan does not include this', hint: 'Upgrade your plan to use it.' },
  subscription_inactive: { title: 'Your subscription is not active', hint: 'Renew it in billing. Local and LAN work still run.' },
  quota_exceeded: { title: 'You used all of this period\'s hosted time', hint: 'It resets at the start of the next period, or you can upgrade. Local and LAN work are never blocked.' },
  seat_limit_reached: { title: 'Your workspace has no free seats', hint: 'Add seats or remove a member.' },
  member_limit_reached: { title: 'This session is full for your plan', hint: 'Remove someone or upgrade your plan.' },
  coupon_invalid: { title: 'That coupon is not valid', hint: 'Check the code, or it may have expired.' },
  // accounts / workspaces
  account_deletion_pending: { title: 'This account is being deleted', hint: 'Cancel the deletion in your account settings if that was a mistake.' },
  api_key_limit_reached: { title: 'You have reached the API key limit', hint: 'Delete one you no longer use.' },
  export_not_ready: { title: 'Your export is still being prepared', hint: 'Try again in a few minutes.' },
  workspace_not_found: { title: 'That workspace was not found', hint: 'It may have been deleted, or you may not be a member.' },
  member_exists: { title: 'That person is already a member' },
  invite_invalid: { title: 'That invite was not found', hint: 'Ask for a new one.' },
  invite_expired: { title: 'That invite expired', hint: 'Ask for a new one.' },
  invite_revoked: { title: 'That invite was cancelled', hint: 'Ask for a new one.' },
  webhook_limit_reached: { title: 'You have reached the webhook limit', hint: 'Delete one you no longer use, or upgrade.' },
  webhook_url_invalid: { title: 'That webhook address is not allowed', hint: 'Use a public https address.' },
  // sessions
  session_not_found: { title: 'That session was not found', hint: 'It may have ended. Check the link or code.' },
  session_ended: { title: 'That session has ended', hint: 'Start a new one.' },
  session_full: { title: 'That session is full' },
  session_locked: { title: 'That session is locked by the host', hint: 'Ask the host to let you in.' },
  session_paused: { title: 'The session is paused', hint: 'It will continue when the host resumes it.' },
  host_required: { title: 'Only the host can do that' },
  muted: { title: 'You are muted in this session', hint: 'Ask the host to unmute you.' },
  // resume / sync
  history_unavailable: { title: 'Older history is no longer available', hint: 'You will see the session from where it is now.' },
  snapshot_missing: { title: 'There is no saved copy to catch up from', hint: 'Centcom will rejoin the session from now.' },
  snapshot_hash_mismatch: { title: 'The saved copy did not match', hint: 'Centcom will fetch it again.' },
  // lan
  pair_bad_code: { title: 'That pairing code is wrong', hint: 'Check the code on the other screen and try again.' },
  pair_locked_out: { title: 'Too many wrong codes', hint: 'Wait a minute, then try again.' },
  // version
  client_too_old: { title: 'This version of Centcom is too old', hint: 'Update Centcom to keep using hosted sessions. Local and LAN work still run.' },
  unsupported_protocol: { title: 'This Centcom and the server cannot talk to each other', hint: 'Update Centcom to the latest version.' },
  // relay
  invalid_frame: { title: 'Centcom sent a message the relay could not read', hint: 'Update Centcom. If it keeps happening, report it.' },
  protocol_violation: { title: 'The connection broke the rules and was closed', hint: 'Update Centcom. If it keeps happening, report it.' },
  frame_too_large: { title: 'That message is too large', hint: 'Send it in smaller parts.' },
  frame_rate_exceeded: { title: 'Sending too fast', hint: 'Centcom will slow down.' },
  slow_consumer: { title: 'Your connection cannot keep up', hint: 'Centcom will reconnect and catch up.' },
  signature_invalid: { title: 'A message failed its signature check and was dropped', hint: 'If this repeats, leave and rejoin the session.' },
  ticket_invalid: { title: 'Your session pass is not valid', hint: 'Centcom will get a new one.' },
  ticket_replayed: { title: 'That session pass was already used', hint: 'Centcom will get a new one.' },
  device_unknown: { title: 'The server does not know this device', hint: 'Run centcom login again.' },
  key_required: { title: 'Waiting for the session key', hint: 'The host needs to be online to share it with you.' },
  key_unknown: { title: 'A message used a key you do not have', hint: 'Rejoin the session to get the latest keys.' },
  lock_denied: { title: 'That file is being edited by another agent', hint: 'Wait for it to finish, or ask them to release it.' },
  queue_full: { title: 'The queue is full', hint: 'Wait for some items to finish.' },
  queue_item_gone: { title: 'That queue item no longer exists', hint: 'It was finished or removed.' },
  queue_not_allowed: { title: 'You cannot add to the queue here', hint: 'Ask the host to change your role.' },
};

/** When a code is unknown to this build, say something true about its HTTP class (CT-ERR rule 7). */
export function classMessage(status: number | undefined): Msg {
  if (status === undefined) return { title: 'Something went wrong', hint: 'Try again.' };
  if (status === 401) return { title: 'You need to sign in', hint: 'Run centcom login.' };
  if (status === 403) return { title: 'You do not have permission to do that' };
  if (status === 404) return { title: 'That could not be found' };
  if (status === 408 || status === 504) return { title: 'The server took too long to answer', hint: 'Try again.' };
  if (status === 426) return { title: 'This version of Centcom is too old', hint: 'Update Centcom.' };
  if (status === 429) return { title: 'Too many requests', hint: 'Wait a moment, then try again.' };
  if (status >= 500) return { title: 'Something went wrong on the server', hint: 'This is not your fault. Try again in a minute.' };
  if (status >= 400) return { title: 'That request could not be completed', hint: 'Update Centcom and try again.' };
  return { title: 'Something went wrong' };
}

/** Errors that never came from the server. */
export const LOCAL_MESSAGES = {
  network: { title: 'Cannot reach the server', hint: 'Check your internet connection. Local and LAN work are not affected.' },
  timeout: { title: 'The server took too long to answer', hint: 'Check your connection and try again.' },
  aborted: { title: 'Cancelled' },
  protocol: { title: 'The server sent something Centcom did not understand', hint: 'Update Centcom. If it keeps happening, report it.' },
} as const satisfies Record<string, Msg>;
