/** Typed errors of the auth client (lane C052). All extend the C006 CentcomError, so userMessage() and nextAction() work on them.
 *  Must not: carry a token, a device code, a PKCE verifier, an auth code or an API key, in the message or anywhere else. */
import { CentcomError } from '../errors/index.js';

/** What to tell people when the OS keychain cannot be used. Shown by the account commands (C053). */
export const KEYCHAIN_REMEDIATION = 'Centcom keeps your sign-in only in the system keychain, and it is not available here. On Linux, install and unlock a Secret Service keyring (for example gnome-keyring or KWallet); on macOS, unlock your login keychain. Until then the sign-in lasts only while this command runs.';

/** There is no usable sign-in: nothing stored, or the server ended it. Only thrown on code paths that need the backend. */
export class AuthRequiredError extends CentcomError {
  /** the server code that ended the sign-in, when there was one (refresh_reuse_detected, token_revoked, ...) */
  readonly reason?: string;
  constructor(reason?: string) {
    super({ kind: 'api', code: 'unauthorized', status: 401 });
    this.name = 'AuthRequiredError'; this.message = reason ? `sign-in required (${reason})` : 'sign-in required'; this.reason = reason;
  }
}

/** The person declined the device login (RFC 8628 access_denied). */
export class DeviceFlowDeniedError extends CentcomError {
  constructor() { super({ kind: 'api', code: 'access_denied', status: 403 }); this.name = 'DeviceFlowDeniedError'; this.message = 'device login was denied'; }
}

/** The device code expired (server said expired_token, or the local deadline from expires_in passed). */
export class DeviceFlowExpiredError extends CentcomError {
  constructor() { super({ kind: 'api', code: 'expired_token', status: 400 }); this.name = 'DeviceFlowExpiredError'; this.message = 'device login expired'; }
}

/** The OS keychain is missing, locked or refused. Nothing is written anywhere else instead. */
export class KeychainUnavailableError extends CentcomError {
  readonly remediation = KEYCHAIN_REMEDIATION;
  constructor(cause?: unknown) { super({ kind: 'protocol', cause }); this.name = 'KeychainUnavailableError'; this.message = 'the system keychain is not available'; }
}

/** The callback URL of a PKCE login was wrong: another redirect, a state mismatch, an error from the server, or a code already used. */
export class PkceCallbackError extends CentcomError {
  readonly reason: 'redirect_mismatch' | 'state_mismatch' | 'missing_code' | 'server_error' | 'replayed';
  constructor(reason: PkceCallbackError['reason']) { super({ kind: 'protocol' }); this.name = 'PkceCallbackError'; this.message = `pkce callback rejected: ${reason}`; this.reason = reason; }
}
