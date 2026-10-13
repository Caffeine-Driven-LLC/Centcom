import { afterEach, describe, expect, it } from 'vitest';
import { FakeEngine } from '@centcom/testkit';
import { AppController } from '../../src/controller.js';
import { ShareSession } from '../../src/collab/share-session.js';
import type { Account } from '../../src/collab/account.js';
import { WS, rig, until } from '../../../net/test/session/rig.js';

let cleanup: (() => Promise<void> | void)[] = []; afterEach(async () => { for (const c of cleanup.splice(0).reverse()) await c(); });
const notices = (c: AppController) => c.state.items.filter((i) => i.kind === 'notice') as { level: string; text: string; detail?: string }[];
async function setup(signedIn = true) {
  const r = await rig(); cleanup.push(() => r.stop());
  const ctl = new AppController({ engine: new FakeEngine({ script: {} }) as never, demo: false, cwd: '/tmp/proj', version: 't', skills: [] }); await ctl.start(); cleanup.push(() => ctl.stop());
  const invites: string[] = [];
  const account = { plain: { getStatus: async () => ({ status: 'ok' }) }, status: async () => ({ signedIn, persisted: true, api: 'x', me: { id: 'u', name: 'A', email: 'a@x', plan: 'team', workspace: { id: WS, name: 'ws' } } }), sessions: async () => r.host.client, workspaces: async () => [{ id: WS, name: 'ws' }],
    inviteToSession: async (_id: string, o: { email?: string }) => { invites.push(o.email ?? ''); return { url: 'https://centcom.dev/i/' + 'A'.repeat(30), token: 'A'.repeat(30) }; } } as unknown as Account;
  const share = new ShareSession(ctl, account); cleanup.push(() => share.close()); return { r, ctl, share, invites };
}
describe('/share in the terminal app', () => {
  it('starts a session, says how to join and invite, hands out links, and stops', async () => {
    const { r, ctl, share, invites } = await setup(); await share.handleCommand(''); expect(share.live).toBe(true); expect(notices(ctl).at(-1)).toMatchObject({ level: 'ok', text: expect.stringContaining('Sharing proj'), detail: expect.stringMatching(/centcom join ses_/) });
    await share.handleCommand('invite bob@example.test'); expect(invites).toEqual(['bob@example.test']); expect(notices(ctl).at(-1)!.detail).toContain('https://centcom.dev/i/');
    await share.handleCommand('invite not-an-address'); expect(invites).toHaveLength(1); await share.handleCommand('link'); expect(notices(ctl).at(-1)!.text).toBe('Watch-only link'); expect(notices(ctl).at(-1)!.detail).toMatch(/#k=/);
    await share.handleCommand('status'); expect(notices(ctl).at(-1)!.text).toMatch(/Shared session ses_/); await share.handleCommand('stop'); expect(share.live).toBe(false); expect(notices(ctl).at(-1)!.text).toBe('Stopped sharing'); void r;
  });
  it('without an account it says how to sign in, and before sharing the other commands say to start', async () => {
    const { ctl, share } = await setup(false); await share.handleCommand('start'); expect(share.live).toBe(false); expect(notices(ctl).at(-1)!.text).toMatch(/needs an account/); await share.handleCommand('link'); expect(ctl.state.toasts.at(-1)!.text).toMatch(/not shared yet/);
  });
  it('a request from an editor arrives as a notice, and /share run lets the agent do it', async () => {
    const { r, ctl, share } = await setup(); await share.handleCommand(''); const sid = (notices(ctl).at(-1)!.detail ?? '').match(/ses_\w+/)![0];
    const g = await r.guest.client.joinSession({ sessionId: sid }); r.guest.handle = g; cleanup.push(() => g.leave().catch(() => undefined)); await until(() => g.state === 'live', 8000);
    const { QueueClient } = await import('@centcom/net'); await new QueueClient(g).submit({ body: 'please add a test' });
    await until(() => notices(ctl).some((n) => /asks: please add a test/.test(n.text))); await share.handleCommand('run'); await until(() => ctl.state.items.some((i) => i.kind === 'user' && (i as { text: string }).text === 'please add a test'));
  });
});
