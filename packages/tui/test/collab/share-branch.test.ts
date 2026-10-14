import { afterEach, describe, expect, it } from 'vitest';
import { FakeEngine } from '@centcom/testkit';
import type { SessionHandle } from '@centcom/net';
import { AppController } from '../../src/controller.js';
import { ShareSession } from '../../src/collab/share-session.js';
import type { Account } from '../../src/collab/account.js';
import { WS, rig, until, type Peer } from '../../../net/test/session/rig.js';

let cleanup: (() => Promise<void> | void)[] = []; afterEach(async () => { for (const c of cleanup.splice(0).reverse()) await c(); });
const notices = (c: AppController) => c.state.items.filter((i) => i.kind === 'notice') as { level: string; text: string; detail?: string }[];
/** `serverMode` makes the server answer with a mode (the mock backend echoes what it is sent, so a server that does not know modes is simulated with `command_post`). */
const account = (peer: Peer, o: { serverMode?: 'branch' | 'command_post'; joinTo?: () => string }): Account => ({
  status: async () => ({ signedIn: true, persisted: true, api: 'x', me: { id: 'u', name: 'A', email: 'a@x', plan: 'team', workspace: { id: WS, name: 'ws' } } }), workspaces: async () => [{ id: WS, name: 'ws' }],
  sessions: async () => ({ ...peer.client, createSession: async (a: Parameters<typeof peer.client.createSession>[0]) => { const h = await peer.client.createSession(a); if (o.serverMode) (h as { mode: string }).mode = o.serverMode; return h; } }),
  joinMember: async () => { const h = await peer.client.joinSession({ sessionId: o.joinTo!() }); if (o.serverMode) (h as { mode: string }).mode = o.serverMode; return { handle: h as SessionHandle, how: 'session' as const }; },
}) as unknown as Account;
async function agent(cwd: string) { const ctl = new AppController({ engine: new FakeEngine({ script: {} }) as never, demo: false, cwd, version: 't', skills: [] }); await ctl.start(); cleanup.push(() => ctl.stop()); return ctl; }

describe('choosing how to work together in the terminal', { timeout: 30_000 }, () => {
  it('/share branch on a server without modes falls back to a command post and says so', async () => {
    const r = await rig(); cleanup.push(() => r.stop()); const ctl = await agent('/tmp/proj'); const share = new ShareSession(ctl, account(r.host, { serverMode: 'command_post' }), { detectLoginKind: async () => 'api_key' }); cleanup.push(() => share.close());
    await share.handleCommand('branch'); expect(share.live).toBe(true); expect(notices(ctl).some((n) => /does not support everyone running their own agent/.test(n.text))).toBe(true); expect(notices(ctl).at(-1)!.text).toBe('Sharing proj');
    await share.handleCommand('team'); expect(ctl.state.toasts.at(-1)!.text).toMatch(/No team yet/);
  });
  it('two people, two conversations, one branch-mode session: /share branch, /share join, /team, handoff', async () => {
    const r = await rig(); cleanup.push(() => r.stop()); const a = await agent('/tmp/ana'); const b = await agent('/tmp/bob'); let sid = '';
    const ana = new ShareSession(a, account(r.host, { serverMode: 'branch' })); const bob = new ShareSession(b, account(r.guest, { serverMode: 'branch', joinTo: () => sid })); cleanup.push(() => ana.close(), () => bob.close());
    await ana.handleCommand('branch'); const first = notices(a).at(-1)!; expect(first.text).toBe('Sharing ana: everyone runs their own agent'); sid = (first.detail ?? '').match(/ses_\w+/)![0];
    await bob.handleCommand(`join ${sid}`); expect(notices(b).at(-1)!.text).toBe('You are in the session with your own agent');
    await until(() => { ana.team(); return (notices(a).at(-1)!.detail ?? '').match(/Fake: /g)?.length === 2; }, 8000);
    const text = notices(a).at(-1)!.detail!; expect(text).toContain('You'); expect(text).toContain('Guest (editor)');
    await ana.handleCommand('handoff 1 finish the tests'); await until(() => { bob.team(); return /work offered to Guest: finish the tests/.test(notices(b).at(-1)!.detail ?? ''); }, 8000);
    await ana.handleCommand('activity off'); expect(a.state.toasts.at(-1)!.text).toMatch(/not shared/);
    await ana.handleCommand('stop'); expect(ana.live).toBe(false);
  });
  it('/watch shows a teammate\'s transcript read only, and says so when they do not share their agent\'s activity', async () => {
    const r = await rig(); cleanup.push(() => r.stop()); const a = await agent('/tmp/ana'); const b = await agent('/tmp/bob'); let sid = '';
    const ana = new ShareSession(a, account(r.host, { serverMode: 'branch' })); const bob = new ShareSession(b, account(r.guest, { serverMode: 'branch', joinTo: () => sid })); cleanup.push(() => ana.close(), () => bob.close());
    await ana.handleCommand('branch'); sid = (notices(a).at(-1)!.detail ?? '').match(/ses_\w+/)![0]; await bob.handleCommand(`join ${sid}`);
    await b.submit('build the importer'); await until(() => !b.state.busy);
    await until(() => { ana.watch('guest'); return /Guest: build the importer[\s\S]*agent: /.test(notices(a).at(-1)!.detail ?? ''); }, 8000);
    const shown = notices(a).at(-1)!; expect(shown.text).toBe("Guest's agent (read only)"); expect(shown.detail).toMatch(/agent: /);
    await bob.handleCommand('activity off'); await ana.handleCommand('activity off'); await a.submit('private work'); await until(() => !a.state.busy);
    await new Promise((res) => setTimeout(res, 300)); bob.watch('1'); const hidden = notices(b).at(-1)!; expect(hidden.detail ?? '').not.toContain('private work');
    ana.watch('nobody'); expect(a.state.toasts.at(-1)!.text).toMatch(/Whose agent/);
  });
  it('joining a command-post session with /share join points to centcom join and leaves', async () => {
    const r = await rig(); cleanup.push(() => r.stop()); const host = await r.host.client.createSession({ name: 'cp', workspace: WS }); r.host.handle = host; cleanup.push(() => host.leave().catch(() => undefined));
    const b = await agent('/tmp/bob'); const bob = new ShareSession(b, account(r.guest, { joinTo: () => host.id })); cleanup.push(() => bob.close()); await bob.handleCommand(`join ${host.id}`);
    expect(notices(b).at(-1)!.text).toMatch(/command post/); expect(bob.live).toBe(false);
  });
});
