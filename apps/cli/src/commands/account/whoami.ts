/** `centcom whoami [--json]`: GET /v1/me (and the active workspace's name). Not signed in is exit 2 with no network call.
 *  Must not: print a token or key; make a request when there is no sign-in. */
import { clean, parseFlags, reportError, type AccountDeps } from './common.js';
import { EXIT, MSG } from './messages.js';

/** The `--json` shape (C053 interface). */
export interface WhoamiJson { user: { id: string; display_name: string; email: string }; plan: string; workspace: { id: string; name: string | null } | null; entitlement_rev: number }

export async function runWhoami(argv: string[], d: AccountDeps): Promise<number> {
  const f = parseFlags(argv, { bool: ['--json'] });
  if ('error' in f || f.positional.length) { d.io.err('error' in f ? f.error : MSG.usage.unknownFlag(f.positional[0]!)); d.io.err(MSG.usage.whoami); return EXIT.failure; }
  try {
    const st = await d.auth.status();
    if (!st.signedIn) { d.io.err(MSG.errors.notSignedIn); if (st.keychain === 'unavailable') d.io.err(MSG.errors.keychain); return EXIT.authRequired; }
    await d.auth.getAccessToken(); /* a sign-in the server ended shows up here, before any API call */
    const me = (await d.http.call('getMe', {})).data;
    let workspace: WhoamiJson['workspace'] = null;
    if (me.active_workspace) {
      const name = await d.http.call('getWorkspace', { path: { id: me.active_workspace } }).then((r) => r.data.name, () => null);
      workspace = { id: me.active_workspace, name };
    }
    const out: WhoamiJson = { user: { id: me.user.id, display_name: me.user.display_name, email: me.user.email }, plan: me.plan, workspace, entitlement_rev: me.ent };
    if (f.bool.has('--json')) { d.io.out(JSON.stringify(out)); return EXIT.ok; }
    d.io.out(MSG.whoami.user(clean(out.user.display_name, 40), clean(out.user.email, 254), out.user.id));
    d.io.out(MSG.whoami.plan(clean(out.plan, 32)));
    d.io.out(workspace ? MSG.whoami.workspace(workspace.name === null ? null : clean(workspace.name), workspace.id) : MSG.whoami.noWorkspace);
    d.io.out(MSG.whoami.ent(out.entitlement_rev));
    if (st.principal === 'api_key') d.io.out(MSG.whoami.viaApiKey);
    return EXIT.ok;
  } catch (e) { return reportError(e, d); }
}
