import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FakeEngine, startMockBackend, type MockBackend } from '../../../packages/testkit/src/index.js';
import { Account, AppController } from '@centcom/tui';
import { CollabService, shareWhy } from '../src/local/collab.js';
import type { ServerMsg, SharingView } from '../src/local/protocol.js';
import type { Workspace } from '../src/local/workspace.js';

let m: MockBackend | undefined; const cleanup: (() => unknown)[] = []; afterEach(async () => { for (const c of cleanup.splice(0).reverse()) await c(); await m?.stop(); m = undefined; });
const instant = { now: () => Date.now(), setTimeout: (f: () => void) => setImmediate(f) as never, clearTimeout: (h: never) => clearImmediate(h as never) } as never;
const until = async (f: () => boolean, ms = 6000) => { const t0 = Date.now(); while (!f()) { if (Date.now() - t0 > ms) throw new Error('timed out waiting'); await new Promise((r) => setTimeout(r, 10)); } };
async function rig(signIn = true) {
  m = await startMockBackend({ seed: 11 });
  const account = await Account.create({ app: 'centcom-desktop', version: '0.1.0', baseUrl: m.url, keychain: 'memory', clock: instant, stateDir: mkdtempSync(join(tmpdir(), 'share-')) });
  if (signIn) { const login = await account.beginLogin(); await m.control('approve-device', { user_code: login.userCode }); await login.wait(); }
  const ctl = new AppController({ engine: new FakeEngine({ script: {} }) as never, demo: false, cwd: '/tmp/proj', version: 't', skills: [] }); await ctl.start(); cleanup.push(() => ctl.stop());
  const ws = { ctl, dir: '/tmp/proj', demo: false } as unknown as Workspace; const got: ServerMsg[] = [];
  const svc = new CollabService({ version: '0', broadcast: () => undefined, openExternal: () => false, makeAccount: async () => account, toViewers: (_w, msg) => got.push(msg) }); cleanup.push(() => svc.stopSharing(ws));
  const view = (): SharingView | null => { const l = [...got].reverse().find((x) => x.t === 'sharing'); return l && l.t === 'sharing' ? l.sharing : null; };
  return { svc, ws, got, view, send: (x: ServerMsg) => got.push(x), account };
}

describe('sharing a conversation from the desktop app', () => {
  it('starts a session in the person\'s workspace, shows it live with the session id, and ends it again', async () => {
    const r = await rig(); await r.svc.handleShare({ t: 'share' }, r.ws, r.send);
    await until(() => r.view()?.state === 'live'); const v = r.view()!; expect(v.sessionId).toMatch(/^ses_/); expect(v.name).toBe('proj'); expect(v.members.some((x) => x.you && x.role === 'host')).toBe(true); expect(v.auto).toBe(false);
    await r.svc.handleShare({ t: 'shareAuto', on: true }, r.ws, r.send); expect(r.view()!.auto).toBe(true);
    await r.svc.handleShare({ t: 'shareLink' }, r.ws, r.send); expect(r.view()!.link?.url).toMatch(/#k=[A-Za-z0-9_-]{43}/);
    await r.svc.handleShare({ t: 'unshare' }, r.ws, r.send); expect(r.view()).toBeNull(); expect(r.svc.sharingOf(r.ws)).toBeNull();
  });
  it('asking again while it is live changes nothing (one session per conversation)', async () => {
    const r = await rig(); await r.svc.handleShare({ t: 'share' }, r.ws, r.send); await until(() => r.view()?.state === 'live'); const id = r.view()!.sessionId; await r.svc.handleShare({ t: 'share' }, r.ws, r.send); expect(r.view()!.sessionId).toBe(id);
  });
  it('without a sign-in it says to sign in, and the demo cannot be shared at all', async () => {
    const r = await rig(false); await r.svc.handleShare({ t: 'share' }, r.ws, r.send); await until(() => r.view()?.state === 'failed'); expect(r.view()).toMatchObject({ code: 'not_signed_in', error: expect.stringMatching(/Sign in/) });
    await r.svc.handleShare({ t: 'share' }, { ...r.ws, demo: true } as never, r.send); expect(r.got.at(-1)).toMatchObject({ t: 'notice' });
  });
  it('a plan without the relay is explained as an upgrade, not as an error code', () => {
    expect(shareWhy(Object.assign(new Error('x'), { code: 'entitlement_required' }))).toMatchObject({ code: 'entitlement_required', error: expect.stringMatching(/Upgrade to Pro or Team/) });
    expect(shareWhy(new Error('fetch failed')).code).toBe('offline');
  });
});
