/** `centcom logout [--revoke-device]`: end the sign-in on the server when it can be reached, and always on this computer.
 *  Must not: need the network to succeed (offline logout clears the keychain and says the server was skipped); print a token. */
import { KeychainUnavailableError } from '@centcom/net';
import { parseFlags, type AccountDeps } from './common.js';
import { EXIT, MSG } from './messages.js';

export async function runLogout(argv: string[], d: AccountDeps): Promise<number> {
  const f = parseFlags(argv, { bool: ['--revoke-device'] });
  if ('error' in f || f.positional.length) { d.io.err('error' in f ? f.error : MSG.usage.unknownFlag(f.positional[0]!)); d.io.err(MSG.usage.logout); return EXIT.failure; }
  try {
    const st = await d.auth.status();
    if (!st.signedIn) { await d.auth.clearLocal().catch(() => undefined); d.io.out(MSG.logout.notSignedIn); return EXIT.ok; }
    let deviceRevoked = false;
    if (f.bool.has('--revoke-device') && st.principal === 'device') {
      try { await d.auth.getAccessToken(); const dev = d.auth.claims()?.dev ?? st.deviceId; if (dev) { await d.http.call('revokeDevice', { path: { id: dev } }, { signal: d.signal }); deviceRevoked = true; } } catch { deviceRevoked = false; }
    }
    const r = await d.auth.logout();
    d.io.out(MSG.logout.signedOut);
    if (r.principal === 'api_key') d.io.out(MSG.logout.apiKeyRemoved);
    if (f.bool.has('--revoke-device') && st.principal === 'device') d.io.out(deviceRevoked ? MSG.logout.deviceRevoked : MSG.logout.deviceRevokeFailed);
    if (r.principal === 'device' && !r.serverRevoked && !deviceRevoked) d.io.err(MSG.logout.revocationSkipped);
    return EXIT.ok;
  } catch (e) {
    if (e instanceof KeychainUnavailableError) { d.io.err(MSG.errors.keychain); d.io.err(e.remediation); return EXIT.failure; }
    d.io.err(MSG.errors.unexpected); return EXIT.failure;
  }
}
