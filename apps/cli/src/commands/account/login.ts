/** `centcom login [--no-browser] [--device-name <name>] [--api-key-stdin] [--json]`: device flow (or an API key from stdin) on top of the C052 auth client.
 *  Must not: print anything credential-like except the user code; touch the keychain before the login is approved; echo an API key back. */
import { API_KEY_RE, ApiError, CentcomError, DeviceFlowDeniedError, DeviceFlowExpiredError, startDeviceLogin, type OperationResponse } from '@centcom/net';
import { clean, parseFlags, reportError, type AccountDeps } from './common.js';
import { isOpenableUrl } from './browser.js';
import { EXIT, MSG } from './messages.js';

type Me = OperationResponse<'getMe'>;
const MAX_KEY_LINE = 4096;

export async function runLogin(argv: string[], d: AccountDeps): Promise<number> {
  const f = parseFlags(argv, { bool: ['--no-browser', '--api-key-stdin', '--json'], value: ['--device-name'] });
  if ('error' in f || f.positional.length) { d.io.err('error' in f ? f.error : MSG.usage.unknownFlag(f.positional[0]!)); d.io.err(MSG.usage.login); return EXIT.failure; }
  const json = f.bool.has('--json');
  if (f.bool.has('--api-key-stdin')) return loginWithKey(d, json);
  /* in --json mode stdout is one JSON document, so the instructions go to stderr */
  const say = json ? d.io.err : d.io.out;
  try {
    const login = await startDeviceLogin({ http: d.http, deviceName: clean(f.values.get('--device-name') ?? d.hostname(), 80) || 'Centcom device', keys: d.keys, clock: d.clock, signal: d.signal });
    say(MSG.login.intro); say(MSG.login.url(clean(login.verificationUriComplete, 300))); say(MSG.login.code(login.userCode)); say(MSG.login.manual(clean(login.verificationUri, 300), login.userCode));
    if (!f.bool.has('--no-browser')) {
      if (!isOpenableUrl(login.verificationUriComplete, d.baseUrl)) say(MSG.login.browserRefused);
      else say((await d.openBrowser(login.verificationUriComplete)) ? MSG.login.browserOpened : MSG.login.browserFailed);
    }
    say(MSG.login.waiting(Math.max(1, Math.round(login.expiresInS / 60))));
    const tokens = await login.poll(d.signal);
    const { persisted } = await d.auth.adopt(tokens);
    const rebind = (d.keys as { rebindDeviceId?: (id: string) => Promise<void> }).rebindDeviceId;
    if (rebind) { try { await rebind.call(d.keys, tokens.deviceId); } catch { /* keys stay under the pending id; C056 retries on next use */ } }
    const me = await d.http.call('getMe', {}).then((r) => r.data, () => null);
    if (!persisted) { d.io.err(MSG.login.notPersisted); d.io.err(MSG.errors.keychain); }
    if (json) d.io.out(JSON.stringify({ signed_in: true, principal: 'device', device: tokens.deviceId, persisted, user: me ? userOf(me) : null, plan: me?.plan ?? null }));
    else d.io.out(me ? MSG.login.signedIn(clean(me.user.display_name, 40), clean(me.user.email, 254), me.plan) : MSG.login.signedInNoProfile);
    return EXIT.ok;
  } catch (e) {
    if (e instanceof DeviceFlowDeniedError) { d.io.err(MSG.login.denied); return EXIT.failure; }
    if (e instanceof DeviceFlowExpiredError) { d.io.err(MSG.login.expired); return EXIT.failure; }
    if (d.signal?.aborted || (e instanceof CentcomError && e.kind === 'aborted')) { d.io.err(MSG.login.cancelled); return EXIT.failure; }
    return reportError(e, d);
  }
}

const userOf = (me: Me) => ({ id: me.user.id, display_name: me.user.display_name, email: me.user.email });

/** `--api-key-stdin`: one line, checked locally before any network call, kept only in the keychain, then checked with GET /v1/me. */
async function loginWithKey(d: AccountDeps, json: boolean): Promise<number> {
  const line = d.readLine ? await d.readLine() : null;
  const key = (line ?? '').slice(0, MAX_KEY_LINE).trim();
  if (!key) { d.io.err(MSG.login.apiKeyMissing); return EXIT.failure; }
  if (!API_KEY_RE.test(key)) { d.io.err(MSG.login.apiKeyMalformed); return EXIT.failure; }
  try {
    const { persisted } = await d.auth.useApiKey(key);
    if (!persisted) { d.io.err(MSG.login.notPersisted); d.io.err(MSG.errors.keychain); }
    let me: Me;
    try { me = (await d.http.call('getMe', {})).data; } catch (e) {
      if (e instanceof ApiError && e.status === 401) { await d.auth.clearLocal().catch(() => undefined); d.io.err(MSG.login.apiKeyRejected); return EXIT.failure; }
      d.io.err(MSG.login.apiKeyStoredUnverified); return reportError(e, d);
    }
    if (json) d.io.out(JSON.stringify({ signed_in: true, principal: 'api_key', persisted, user: userOf(me), plan: me.plan }));
    else d.io.out(MSG.login.apiKeySignedIn(clean(me.user.display_name, 40), me.plan));
    return EXIT.ok;
  } catch (e) { return reportError(e, d); }
}
