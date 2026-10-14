import React from 'react';
import { renderToString } from 'ink';
import { afterEach, describe, expect, it } from 'vitest';
import { FakeEngine } from '@centcom/testkit';
import { createTheme } from '@centcom/theme';
import { AppController } from '../../src/controller.js';
import { ShareSession } from '../../src/collab/share-session.js';
import { StatusBar } from '../../src/components/StatusBars.js';
import { ThemeCtx } from '../../src/components/ui.js';
import type { Account } from '../../src/collab/account.js';
import { WS, rig, until } from '../../../net/test/session/rig.js';

let cleanup: (() => Promise<void> | void)[] = []; afterEach(async () => { for (const c of cleanup.splice(0).reverse()) await c(); });
const make = () => new AppController({ engine: new FakeEngine({ script: {} }) as never, demo: false, cwd: '/tmp/proj', version: 't', skills: [] });
const texts = (c: AppController) => c.state.toasts.map((t) => t.text);

/** Lane C063: what the person sees when the hosted link changes, and that a shared session feeds it. */
describe('the link to the hosted service, in words', () => {
  it('each change says one thing once; coming back says so; nothing is said when it was never lost', () => {
    const c = make(); c.setNet('online'); expect(texts(c)).toEqual([]);
    c.setNet('reconnecting', 'online'); expect(texts(c).at(-1)).toMatch(/Reconnecting/); c.setNet('offline', 'reconnecting'); expect(texts(c).at(-1)).toMatch(/Offline.*continues/);
    c.setNet('offline', 'offline'); expect(texts(c).filter((t) => /Offline/.test(t))).toHaveLength(1); c.setNet('online', 'offline'); expect(texts(c).at(-1)).toMatch(/Back online/);
    c.setNet('backend-down', 'online'); expect(texts(c).at(-1)).toMatch(/service is down.*Local work is not affected/); c.setNet('degraded', 'online'); expect(texts(c).at(-1)).toMatch(/slow/); c.stop();
  });
  it('the status line names a bad link with a glyph and a word, and shows nothing when it is fine or not shared', () => {
    const c = make(); const show = () => renderToString(<ThemeCtx.Provider value={createTheme('dark', 'none')}><StatusBar s={c.state} width={110} line="header" /></ThemeCtx.Provider>, { columns: 120 });
    expect(show()).not.toMatch(/offline|reconnecting|service/); c.setNet('online'); expect(show()).not.toMatch(/offline|reconnecting/);
    c.setNet('reconnecting', 'online'); expect(show()).toContain('↻ reconnecting'); c.setNet('offline', 'reconnecting'); expect(show()).toContain('○ offline'); c.setNet('backend-down', 'offline'); expect(show()).toContain('✗ service down'); c.setNet(undefined); expect(show()).not.toMatch(/service down/); c.stop();
  });
});

describe('a shared session on the mock relay feeds the link state', () => {
  it('the relay going away shows reconnecting then offline, coming back shows online; stopping clears it', { timeout: 90_000 }, async () => {
    const r = await rig(); cleanup.push(() => r.stop()); const ctl = make(); await ctl.start(); cleanup.push(() => ctl.stop());
    const account = { plain: { getStatus: async () => ({ status: 'ok' }) }, status: async () => ({ signedIn: true, persisted: true, api: 'x', me: { id: 'u', name: 'A', email: 'a@x', plan: 'team', workspace: { id: WS, name: 'ws' } } }), sessions: async () => r.host.client, workspaces: async () => [{ id: WS, name: 'ws' }] } as unknown as Account;
    const share = new ShareSession(ctl, account, { detectLoginKind: async () => 'api_key' }); cleanup.push(() => share.close()); await share.handleCommand(''); expect(share.live).toBe(true); expect(ctl.state.net).toBe('online');
    const sid = ctl.state.items.filter((i) => i.kind === 'notice').at(-1) as { detail?: string }; const id = (sid.detail ?? '').match(/ses_\w+/)![0];
    await r.m.control('maintenance', { on: true }); await r.m.control('disconnect', { sid: id, code: 1001 });
    await until(() => ctl.state.net === 'reconnecting' || ctl.state.net === 'offline', 15_000); await until(() => ctl.state.net === 'offline', 60_000); expect(texts(ctl).some((t) => /Offline|Reconnecting/.test(t))).toBe(true);
    await r.m.control('maintenance', { on: false }); await until(() => ctl.state.net === 'online', 60_000); expect(texts(ctl).some((t) => /Back online/.test(t))).toBe(true);
    await share.handleCommand('stop'); expect(ctl.state.net).toBeUndefined();
  });
});
