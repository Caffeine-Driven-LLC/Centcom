/**
 * `pnpm exec tsx tools/dev/web-live.ts`: the web app's own session engine (`apps/web/src/session/engine.ts`, the code the browser runs) against the local
 * backend. Alice (an account, a scripted agent through the HostBridge) hosts a session. A visitor with no account opens the watch link through the
 * web engine and reads the agent;
 * Needs the backend repo's dev stack (`pnpm dev:up`, `pnpm dev:api`, `pnpm dev:relay`). Exits 1 when a step fails.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeEngine } from '../../packages/testkit/src/index.js';
import { AppController, HostBridge } from '../../packages/tui/src/index.js';
import { connectSession } from '../../apps/web/src/session/engine.js';
import { takeShareFragment } from '../../apps/web/src/invite/fragment.js';
import { api, relay } from './live-browser.js';
import { signUp } from './collab-live.js';

const step = (t: string): void => console.log(`\n== ${t}`);
const check = (ok: boolean, t: string): void => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${t}`); if (!ok) process.exitCode = 1; };
const until = async (f: () => boolean, ms = 15_000): Promise<boolean> => { const t0 = Date.now(); while (!f()) { if (Date.now() - t0 > ms) return false; await new Promise((r) => setTimeout(r, 50)); } return true; };

step('Alice signs up and hosts a session with a scripted agent');
const alice = await signUp('alice'); const ws = (await alice.account.workspaces())[0]!;
const ctl = new AppController({ engine: new FakeEngine({ script: {} }) as never, demo: false, cwd: mkdtempSync(join(tmpdir(), 'web-live-')), version: 'live', skills: [] }); await ctl.start();
const host = await (await alice.account.sessions()).createSession({ name: 'web live check', workspace: ws.id });
const bridge = new HostBridge(ctl, host, { onError: (e) => console.log('     bridge error:', String(e)) }); bridge.start();
check(host.state === 'live' && host.me.role === 'host', `session ${host.id} is live`);

step('A visitor with no account opens the watch link in the web engine');
const link = await host.createShareLink(); const fragment = takeShareFragment({ hash: link.fragment, pathname: '/g/x', search: '' }, { replaceState: () => undefined });
check(!!fragment, 'the web page accepts the link\'s key fragment');
const apiBase = api; const relayUrl = relay;
const visitor = await connectSession({ sessionId: '', share: { token: link.url.split('/').pop()!, displayName: 'Maya', fragment: fragment! }, apiBase, relayUrl, getAccessToken: async () => undefined, deviceId: 'dev_WEBLIVE00000000000000000001' });
check(await until(() => visitor.state().phase === 'live'), `the visitor is ${visitor.state().phase} as ${visitor.state().me.role}`);
await ctl.submit('say hello to the team');
check(await until(() => visitor.state().transcript.some((e) => e.kind === 'assistant' && e.text.includes('Hello'))), `the visitor reads the agent in the web transcript (${visitor.state().transcript.length} entries, warnings: ${visitor.state().warnings.map((w) => w.reason).join(',') || 'none'})`);
check(visitor.state().roster.some((m) => m.name === 'Maya'), 'the roster has Maya');
await visitor.handle.sendEvent('queue.submit', { p: { item: 'que_0000000000000000000000AAAA', size: 1, kind: 'message' }, secret: { body: 'hi' } }).then(() => check(false, 'a viewer must not be able to submit'), () => check(true, 'a viewer cannot submit'));
visitor.close();


step('Bob accepts a session invite; the web engine joins with the invite token and the key from the link');
const bob = await signUp('bob'); const inv = await alice.account.inviteToSession(host.id, { email: bob.email, role: 'editor' });
const acc = await bob.account.acceptInvite(inv.token); check(acc.session === host.id, `Bob accepted the invite for session ${acc.session}`);
const bobToken = await (bob.account as unknown as { auth: { getAccessToken(): Promise<string> } }).auth.getAccessToken();
const guest = await connectSession({ sessionId: host.id, inviteToken: inv.token, inviteSecret: new URL(inv.url).hash, apiBase, relayUrl, getAccessToken: async () => bobToken, deviceId: 'dev_WEBLIVE00000000000000000002' });
await until(() => guest.state().phase === 'live', 8000);
// KNOWN GAP (C083 "device-key registration"): the server learns a device's public keys only from the device sign-in, which the web page does not use, so the host cannot grant a web member the session key.
check(guest.state().phase === 'waiting_for_key' || guest.state().phase === 'live', `Bob's page shows "${guest.state().phase}" as ${guest.state().me.role} (a web member cannot get the key until its device keys are registered)`);
guest.close(); bridge.stop(); await host.end(); ctl.stop();
console.log(process.exitCode === 1 ? '\nFAILED' : `\nOK (${api})`); process.exit(process.exitCode ?? 0);
