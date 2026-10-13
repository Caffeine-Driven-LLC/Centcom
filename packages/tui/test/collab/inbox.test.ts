import { afterEach, describe, expect, it } from 'vitest';
import type { MockBackend } from '@centcom/testkit';
import { FakeEngine } from '@centcom/testkit';
import { mockWith } from '../../../net/test/support.js';
import { AppController } from '../../src/controller.js';
import { ShareSession } from '../../src/collab/share-session.js';
import type { Account } from '../../src/collab/account.js';

let m: MockBackend | undefined; const cleanup: (() => void)[] = []; afterEach(async () => { for (const c of cleanup.splice(0)) c(); await m?.stop(); m = undefined; });
const notices = (c: AppController) => c.state.items.filter((i) => i.kind === 'notice') as { level: string; text: string; detail?: string }[];

/** Lane C066: the notifications client in the terminal app: /inbox lists what is unread in the app's own words and /inbox read clears it. */
describe('/inbox in the terminal app', () => {
  it('lists the unread items from the service in local words, then reads them all; an empty inbox says so', async () => {
    const t = await mockWith(); m = t.m; const ctl = new AppController({ engine: new FakeEngine({ script: {} }) as never, demo: false, cwd: '/tmp/proj', version: 't', skills: [] }); await ctl.start(); cleanup.push(() => ctl.stop());
    const account = { http: t.http, plain: t.http, status: async () => ({ signedIn: true, persisted: true, api: 'x', me: { id: 'u', name: 'A', email: 'a@x', plan: 'team' } }) } as unknown as Account; const share = new ShareSession(ctl, account); cleanup.push(() => share.close());
    await share.handleCommand('inbox'); const first = notices(ctl).at(-1)!; expect(first.text).toMatch(/^Inbox \(\d+ unread\)|^Inbox \(the 10 newest unread\)/); expect(first.detail).toMatch(/1\. /); expect(first.detail).toContain('/inbox read');
    expect(first.detail).not.toMatch(/notif\.|\{[a-z_]+\}/); // keys and placeholders never reach the screen
    await share.handleCommand('inbox read'); expect(ctl.state.toasts.at(-1)!.text).toBe('Everything is marked read.'); expect(t.seen.some((r) => r.method === 'POST' && /notifications\/read/.test(r.url.pathname))).toBe(true); // the mock does not keep state, so the list itself is not re-checked
  });
  it('an empty inbox says so', async () => {
    const ctl = new AppController({ engine: new FakeEngine({ script: {} }) as never, demo: false, cwd: '/tmp/proj', version: 't', skills: [] }); await ctl.start(); cleanup.push(() => ctl.stop());
    const http = { paginate: () => (async function* () { /* nothing */ })(), call: async () => ({ data: {} }) }; const share = new ShareSession(ctl, { http, plain: http, status: async () => ({ signedIn: true, persisted: true, api: 'x', me: { id: 'u', name: 'A', email: 'a@x', plan: 'team' } }) } as unknown as Account);
    cleanup.push(() => share.close()); await share.handleCommand('inbox'); expect(ctl.state.toasts.at(-1)!.text).toBe('Your inbox is empty.');
  });
  it('without an account it says how to sign in', async () => {
    const t = await mockWith(); m = t.m; const ctl = new AppController({ engine: new FakeEngine({ script: {} }) as never, demo: false, cwd: '/tmp/proj', version: 't', skills: [] }); await ctl.start(); cleanup.push(() => ctl.stop());
    const share = new ShareSession(ctl, { http: t.http, plain: t.http, status: async () => ({ signedIn: false, persisted: false, api: 'x' }) } as unknown as Account); await share.handleCommand('inbox'); expect(notices(ctl).at(-1)).toMatchObject({ level: 'warn', text: 'The inbox needs an account' });
  });
  it('/inbox is in the command list, and without the sharing handler (no account wiring) it says how to get one', async () => {
    const { COMMANDS } = await import('../../src/state/commands.js'); expect(COMMANDS.some((c) => c.name === 'inbox')).toBe(true);
    const ctl = new AppController({ engine: new FakeEngine({ script: {} }) as never, demo: true, cwd: '/tmp', version: 't', skills: [] }); await ctl.runCommand('/inbox'); expect(ctl.state.toasts.at(-1)!.text).toMatch(/needs an account/); ctl.stop();
  });
});
