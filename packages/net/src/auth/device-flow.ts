/** RFC 8628 device authorization grant against CT-AUTH: start, then poll the token endpoint until approved, denied, expired or cancelled.
 *  Must not: poll faster than the server's interval, poll after the deadline, leave a timer behind, or log or throw anything that holds the device code or a token. */
import type { HttpClient } from '../http/index.js';
import { ApiError, TransportError } from '../http/index.js';
import type { Logger } from '../log/index.js';
import { DeviceFlowDeniedError, DeviceFlowExpiredError } from './errors.js';
import { DEFAULT_CLI_SCOPES, abortError, realAuthClock, sleepOn, tokenSetFrom, type AuthClock, type DeviceKeyProvider, type TerminalClientId, type TokenSet } from './types.js';

export const DEVICE_CODE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';
/** RFC 8628 §3.5: each slow_down adds 5 seconds to the interval, for the rest of the flow. */
export const SLOW_DOWN_STEP_S = 5;
/** Polling gives up after this many network failures in a row (the deadline still applies first). */
export const MAX_POLL_NETWORK_FAILURES = 3;
const KEY_RE = /^[A-Za-z0-9_-]{43}$/;
const USER_CODE_RE = /^[A-Z2-9]{4}-[A-Z2-9]{4}$/;

/** A started device login. Show `userCode` and `verificationUriComplete`, then `poll()`. */
export interface DeviceLogin {
  /** ABCD-EFGH: the only credential-like value that may be shown */
  userCode: string;
  verificationUri: string; verificationUriComplete: string;
  expiresInS: number; intervalS: number;
  /** Wait for the person. Resolves with tokens, or rejects with DeviceFlowDeniedError, DeviceFlowExpiredError, an aborted CentcomError or the server's error. Call once. */
  poll(signal?: AbortSignal): Promise<TokenSet>;
}

export interface DeviceLoginOptions {
  /** an HTTP client (C051); the device endpoints are public, so its identity does not matter */
  http: HttpClient;
  deviceName: string;
  clientId?: TerminalClientId;
  /** default: the CT-AUTH CLI scope string */
  scopes?: string;
  keys: DeviceKeyProvider;
  clock?: AuthClock;
  logger?: Logger;
  signal?: AbortSignal;
}

/** Start a device login: POST /v1/auth/device/code with this device's public keys. No polling happens until `poll()`. */
export async function startDeviceLogin(opts: DeviceLoginOptions): Promise<DeviceLogin> {
  const clientId = opts.clientId ?? 'centcom-cli'; const clock = opts.clock ?? realAuthClock; const log = opts.logger?.child({ component: 'auth' });
  const deviceName = opts.deviceName.trim().slice(0, 80) || 'Centcom device';
  const pub = await opts.keys.getOrCreatePublicKeys();
  if (!KEY_RE.test(pub.x25519) || !KEY_RE.test(pub.ed25519)) throw new TypeError('device public keys must be 32-byte base64url strings (43 characters)');
  const r = await opts.http.call('startDeviceAuthorization', { body: { client_id: clientId, scope: opts.scopes ?? DEFAULT_CLI_SCOPES, device_name: deviceName, device_pubkeys: { x25519: pub.x25519, ed25519: pub.ed25519 } } }, { signal: opts.signal });
  const d = r.data;
  if (!USER_CODE_RE.test(d.user_code)) throw new TypeError('the server sent a user code that is not ABCD-EFGH');
  const deviceCode = d.device_code; const started = clock.now();
  const expiresInS = Math.max(1, Math.floor(d.expires_in)); const intervalS = Math.max(1, Math.floor(d.interval));
  log?.info('auth.device_flow.started', { expires_in: expiresInS, interval: intervalS, request_id: r.requestId });
  let used = false;

  async function poll(signal?: AbortSignal): Promise<TokenSet> {
    if (used) throw new TypeError('poll() was already called for this device login'); used = true;
    const deadline = started + expiresInS * 1000; let interval = intervalS; let extraWaitS = 0; let netFailures = 0; let polls = 0;
    for (;;) {
      if (signal?.aborted) throw abortError();
      const waitMs = Math.min((interval + extraWaitS) * 1000, Math.max(0, deadline - clock.now())); extraWaitS = 0;
      await sleepOn(clock, waitMs, signal);
      if (clock.now() >= deadline) { log?.info('auth.device_flow.expired', { polls, local: true }); throw new DeviceFlowExpiredError(); }
      polls++;
      try {
        const t = await opts.http.call('issueToken', { body: { grant_type: DEVICE_CODE_GRANT, device_code: deviceCode, client_id: clientId } }, { signal });
        log?.info('auth.device_flow.approved', { polls, request_id: t.requestId });
        return tokenSetFrom(t.data);
      } catch (e) {
        if (signal?.aborted) throw abortError();
        if (e instanceof ApiError) {
          netFailures = 0;
          switch (e.rawCode) {
            case 'authorization_pending': continue;
            case 'slow_down': interval += SLOW_DOWN_STEP_S; log?.debug('auth.device_flow.slow_down', { interval }); continue;
            case 'access_denied': log?.info('auth.device_flow.denied', { polls }); throw new DeviceFlowDeniedError();
            case 'expired_token': log?.info('auth.device_flow.expired', { polls, local: false }); throw new DeviceFlowExpiredError();
            case 'rate_limited': extraWaitS = Math.max(0, (e.retryAfterS ?? interval) - interval); continue; /* never below the interval */
            default: throw e;
          }
        }
        if (e instanceof TransportError && e.transport !== 'aborted' && ++netFailures < MAX_POLL_NETWORK_FAILURES) { log?.debug('auth.device_flow.network', { transport: e.transport, failures: netFailures }); continue; }
        throw e;
      }
    }
  }
  return { userCode: d.user_code, verificationUri: d.verification_uri, verificationUriComplete: d.verification_uri_complete, expiresInS, intervalS, poll };
}
