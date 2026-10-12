import { afterEach, describe, expect, it } from 'vitest';
import { FakeEngine } from '@centcom/testkit';
import { AppController } from '../../src/controller.js';
import { HostBridge } from '../../src/collab/host-bridge.js';
import { JoinedSession } from '../../src/collab/joined.js';
import { parseJoinTarget } from '../../src/collab/target.js';
import { WS, rig, until } from '../../../net/test/session/rig.js';

const SID = 'ses_01KDVDNA00DEVSEED000000001'; const TOK = 'A'.repeat(43);
describe('what people paste to join', () => {
  it('knows a session id, an invite link or token, and a watch-only link (with its key kept apart)', () => {
    expect(parseJoinTarget(SID)).toEqual({ kind: 'session', id: SID }); expect(parseJoinTarget(`  ${SID}\n`)).toEqual({ kind: 'session', id: SID });
    expect(parseJoinTarget(`https://centcom.dev/i/${TOK}`)).toEqual({ kind: 'invite', token: TOK }); expect(parseJoinTarget(`centcom://i/${TOK}`)).toEqual({ kind: 'invite', token: TOK }); expect(parseJoinTarget(TOK)).toEqual({ kind: 'invite', token: TOK });
    expect(parseJoinTarget(`https://centcom.dev/j/${TOK}#k=${'B'.repeat(43)}&kid=k1`)).toEqual({ kind: 'watch', token: TOK, fragment: `#k=${'B'.repeat(43)}&kid=k1` });
    expect(parseJoinTarget(`https://centcom.dev/s/${SID}`)).toEqual({ kind: 'session', id: SID });
  });
  it('refuses anything else', () => { for (const x of ['', 'hello world', 'ftp://x/i/' + TOK, 'https://centcom.dev/i/short', 'javascript:alert(1)', 'a'.repeat(3000)]) expect(parseJoinTarget(x), x).toBeUndefined(); });
});

let cleanup: (() => Promise<void> | void)[] = []; afterEach(async () => { for (const c of cleanup.splice(0).reverse()) await c(); });
describe('a joined session', () => {
  it('shows the host\'s transcript as it happens, who is there, and an editor can ask (a viewer cannot)', async () => {
    const r = await rig(); cleanup.push(() => r.stop()); const host = await r.host.client.createSession({ name: 's', workspace: WS }); r.host.handle = host; cleanup.push(() => host.leave().catch(() => undefined));
    const ctl = new AppController({ engine: new FakeEngine({ script: {} }) as never, demo: false, cwd: '/tmp', version: 't', skills: [] }); await ctl.start(); cleanup.push(() => ctl.stop());
    const bridge = new HostBridge(ctl, host, { flushMs: 5 }); bridge.start(); cleanup.push(() => bridge.stop());
    const g = await r.guest.client.joinSession({ sessionId: host.id }); r.guest.handle = g; await until(() => g.state === 'live', 8000); const joined = new JoinedSession(g); cleanup.push(() => joined.leave());
    await ctl.submit('what is up'); await until(() => joined.state().transcript.some((e) => e.kind === 'assistant'), 8000); const t = joined.state().transcript;
    expect(t.find((e) => e.kind === 'user')).toMatchObject({ text: 'what is up' }); expect(joined.people().map((p) => p.role).sort()).toEqual(['editor', 'host']); expect(joined.people().find((p) => p.you)?.role).toBe('editor');
    const asked = await joined.ask('  add a test  '); await until(() => bridge.pending().length === 1); expect(bridge.pending()[0]).toMatchObject({ item: asked.item, text: 'add a test' });
    await expect(joined.ask('   ')).rejects.toThrow(/Write something/);
  });
  it('a viewer reads but cannot ask', async () => {
    const r = await rig(); cleanup.push(() => r.stop()); const host = await r.host.client.createSession({ name: 's', workspace: WS }); r.host.handle = host; cleanup.push(() => host.leave().catch(() => undefined));
    const joined = new JoinedSession({ ...Object.create(host), me: { ...host.me, role: 'viewer' }, roster: () => host.roster(), muted: () => ({ muted: false }), history: host.history, onAny: host.onAny.bind(host), on: host.on.bind(host), state: 'live', leave: async () => undefined, id: host.id } as never);
    await expect(joined.ask('hi')).rejects.toMatchObject({ code: 'forbidden' }); await joined.leave();
  });
});
