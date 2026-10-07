export type AuthErrorCode = 'no_pending_login' | 'state_mismatch' | 'access_denied' | 'exchange_failed' | 'cookies_blocked' | 'signed_out' | 'network';
/** What the screen may say: a fixed neutral text per code, never text from the server or the URL. */
export const AUTH_MESSAGES: Record<AuthErrorCode, string> = { no_pending_login: 'That sign-in link is no longer valid.', state_mismatch: 'That sign-in could not be verified.', access_denied: 'Sign-in was cancelled.', exchange_failed: 'Sign-in did not finish.', cookies_blocked: 'Your browser blocked sign-in cookies.', signed_out: 'You were signed out.', network: 'Centcom could not be reached.' };
export class AuthError extends Error { constructor(readonly code: AuthErrorCode) { super(AUTH_MESSAGES[code]); this.name = 'AuthError'; } }
/** Codes that end the session without a refresh attempt. */
export const HARD_SIGNOUT = new Set(['token_revoked', 'device_revoked', 'token_invalid']);
