/** Types shared by the auth client files (lane C052). Wire shapes come from the generated OpenAPI types; nothing here is hand-written wire data. */
import { CentcomError } from '../errors/index.js';
import type { HttpClock, OperationResponse } from '../http/index.js';
import type { DeviceKeyProvider as CryptoDeviceKeyProvider } from '../crypto/index.js';
import { decodeAccessClaims } from './jwt-claims.js';

/** Timers for polling and token expiry. `@centcom/testkit`'s VirtualClock and the HTTP client's clock both fit. */
export type AuthClock = HttpClock;

/** Supplies this device's public keys for the device flow. C056's DeviceKeyStore fits (this is the part of it the auth client uses). */
export type DeviceKeyProvider = Pick<CryptoDeviceKeyProvider, 'getOrCreatePublicKeys'>;

/** The CT-AUTH public client ids a terminal can use. */
export type TerminalClientId = 'centcom-cli' | 'centcom-tui';

/** CT-AUTH: the CLI default scope string. */
export const DEFAULT_CLI_SCOPES = 'profile workspaces:read sessions:read sessions:write sessions:host usage:write billing:read';

/** What a successful token request gives. The access token stays in memory; the refresh token goes to the keychain. */
export interface TokenSet {
  accessToken: string; refreshToken: string; expiresInS: number; scope: string;
  /** the `dev_` id the tokens are bound to (from the response, else the `dev` claim) */
  deviceId: string;
  userId?: string;
}

/** Map a TokenResponse to a TokenSet. Throws a protocol error (never naming a token) when the device id is missing. */
export function tokenSetFrom(r: OperationResponse<'issueToken'>): TokenSet {
  const claims = decodeAccessClaims(r.access_token);
  const deviceId = r.device ?? claims?.dev;
  if (!deviceId) throw new CentcomError({ kind: 'protocol', detail: 'The token answer names no device.' });
  return { accessToken: r.access_token, refreshToken: r.refresh_token, expiresInS: r.expires_in, scope: r.scope, deviceId, ...(r.user ?? claims?.sub ? { userId: r.user ?? claims?.sub } : {}) };
}

/** Sleep on an injected clock, cancellable. Rejects with the signal's abort. Leaves no timer behind either way. */
export function sleepOn(clock: AuthClock, ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const onAbort = () => { clock.clearTimeout(h as never); reject(abortError()); };
    const h = clock.setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, Math.max(0, ms));
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
/** The error an aborted wait or poll rejects with. */
export const abortError = (): CentcomError => new CentcomError({ kind: 'aborted' });

/** The real clock. */
export const realAuthClock: AuthClock = { now: () => Date.now(), setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h as unknown as ReturnType<typeof setTimeout>) };
