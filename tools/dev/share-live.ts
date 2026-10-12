/**
 * `pnpm dev:share`: the apps' sharing code against the local backend with two brand-new accounts. Alice's conversation (a scripted
 * agent) is hosted through the HostBridge; Bob signs up, is invited into Alice's workspace, joins by session id, reads what the agent
 * says, asks for something through the queue, and Alice approves it. Needs the backend repo's dev stack. Exits 1 when a step fails.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeEngine } from '../../packages/testkit/src/index.js';
import { AppController, HostBridge } from '../../packages/tui/src/index.js';
import { api } from './live-browser.js';
import { signUp } from './collab-live.js';

const step = (t: string): void => console.log(`\n== ${t}`);
const check = (ok: boolean, t: string): void => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${t}`); if (!ok) process.exitCode = 1; };
const until = async (f: () => boolean, ms = 15_000): Promise<boolean> => { const t0 = Date.now(); while (!f()) { if (Date.now() - t0 > ms) return false; await new Promise((r) => setTimeout(r, 50)); } return true; };

step('Alice and Bob sign up'); const alice = await signUp('alice'); const bob = await signUp('bob');
const aWs = (await alice.account.workspaces())[0]!; check(!!aWs, `Alice's workspace: ${aWs.name}`);
step('Alice shares a conversation'); 
const ctl = new AppController({ engine: new FakeEngine({ script: {} }) as never, demo: false, cwd: mkdtempSync(join(tmpdir(), 'share-live-')), version: 'live', skills: [] }); await ctl.start();
const aliceSessions = await alice.account.sessions(); const host = await aliceSessions.createSession({ name: 'live check', workspace: aWs.id });
const bridge = new HostBridge(ctl, host, { onError: (e) => console.log('     bridge error:', String(e)) }); bridge.start();
check(host.state === 'live' && host.me.role === 'host', `session ${host.id} is live, Alice is host`);
step('Alice invites Bob to this one session; Bob accepts and joins');
const inv = await alice.account.inviteToSession(host.id, { email: bob.email, role: 'editor' }); check(typeof inv.token === 'string', 'the session invite has a link');
const acc = await bob.account.acceptInvite(inv.token); check(acc.session === host.id, `Bob accepted: session ${acc.session}, role ${acc.role}, no workspace seat`);
const { joined: bobView, how } = await bob.account.join(inv.url); const guest = bobView.handle; check(how === 'invite', 'Bob pasted the invite link');
check(await until(() => guest.state === 'live'), `Bob is ${guest.me.role} and ${guest.state}`);
const seen: string[] = []; guest.onAny((e) => { if (e.kind === 'message.assistant.delta') seen.push(String(e.secret?.delta)); });
step('The agent answers Alice; Bob reads it'); await ctl.submit('say hello to the team'); check(await until(() => seen.join('').length > 0), `Bob read: "${seen.join('')}"`);
step('Bob asks for something; Alice approves; the agent runs it'); const q = bobView.queue; const asked = await bobView.ask('please add a test');
check(await until(() => bridge.pending().length === 1), 'the request reached Alice'); await bridge.approve(asked.item);
check(await until(() => ctl.state.items.some((i) => i.kind === 'user' && (i as { text: string }).text === 'please add a test')), 'the agent ran it as a message from Bob'); check(await until(() => q.get(asked.item)?.state === 'done'), `the request is done for Bob (state: ${q.get(asked.item)?.state})`);
check(await until(() => bobView.state().transcript.some((e) => e.kind === 'assistant' && e.text.includes('Hello there'))), `Bob's transcript shows the answer (${bobView.state().transcript.length} entries) and ${bobView.people().length} people`);
step('A visitor opens the watch-only link (no account)');
const link = await host.createShareLink(); const visitor = await (await import('../../packages/tui/src/collab/index.js')).Account.create({ app: 'centcom-tui', version: '0.1.0', baseUrl: api, keychain: 'memory', stateDir: mkdtempSync(join(tmpdir(), 'visitor-')) });
const { joined: vis, how: vhow } = await visitor.join(link.url + link.fragment); check(vhow === 'watch' && vis.role === 'viewer', 'the visitor is a viewer');
await ctl.submit('and say goodbye'); check(await until(() => vis.state().transcript.some((e) => e.kind === 'assistant')), `the visitor reads the agent (${vis.state().transcript.length} entries, warnings: ${vis.state().warnings.map((w) => w.reason).join(',') || 'none'})`);
await vis.ask('hi').then(() => check(false, 'a viewer must not be able to ask'), () => check(true, 'a viewer cannot ask'));
await vis.leave(); await bobView.leave(); bridge.stop(); await host.end(); ctl.stop();
console.log(process.exitCode === 1 ? '\nFAILED' : `\nOK (${api})`); process.exit(process.exitCode ?? 0);
