import { afterEach, describe, expect, it } from 'vitest';
import type { SessionHandle } from '@centcom/net';
import { FakeEngine } from '@centcom/testkit';
import { AppController } from '../../src/controller.js';
import { HostBridge } from '../../src/collab/host-bridge.js';
import { WS, rig, until } from '../../../net/test/session/rig.js';

let cleanup: (() => Promise<void> | void)[] = []; afterEach(async () => { for (const c of cleanup.splice(0).reverse()) await c(); });
async function person(handle: SessionHandle, ask: boolean) {
  const ctl = new AppController({ engine: new FakeEngine({ script: {} }) as never, demo: false, cwd: '/tmp', version: 't', skills: [] }); await ctl.start(); cleanup.push(() => ctl.stop());
  const bridge = new HostBridge(ctl, handle, { mode: 'branch', flushMs: 5, branchProbe: async () => ({ branch: 'b', head: 'abc1234', ahead: 0, behind: 0, dirty: false }), ...(ask ? { askTeammates: { approver: 'any_editor' as const } } : {}) }); bridge.start(); cleanup.push(() => bridge.stop());
  return { ctl, bridge };
}
const ask = (ctl: AppController, id: string, ac = new AbortController()) => ctl.promptApproval({ approval_id: id, agent_id: ctl.state.agents.find((a) => a.mine)!.id, tool: 'Bash', summary: 'run tests', command: 'pnpm test', risk: 'medium' } as never, ac.signal);
async function setup(askFirst: boolean) {
  const r = await rig(); cleanup.push(() => r.stop());
  const host = await r.host.client.createSession({ name: 'branches', workspace: WS, mode: 'branch' } as never); r.host.handle = host; cleanup.push(() => host.leave().catch(() => undefined));
  const guest = await r.guest.client.joinSession({ sessionId: host.id }); r.guest.handle = guest; cleanup.push(() => guest.leave().catch(() => undefined)); await until(() => guest.state === 'live', 60000);
  return { a: await person(host, askFirst), b: await person(guest, false), host, guest };
}

describe('branch mode: permission questions go to teammates (C061 wired)', { timeout: 180_000 }, () => {
  it('a teammate approves: the question on the owner screen is answered and the tool is allowed', async () => {
    const { a, b } = await setup(true); const p = ask(a.ctl, 'ap_1'); await until(() => (b.bridge.remote!.waiting().length) === 1, 60000);
    expect(b.bridge.remote!.waiting()[0]).toMatchObject({ summary: 'run tests', command: 'pnpm test' }); await b.bridge.remote!.decide(b.bridge.remote!.waiting()[0]!.approvalId, { decision: 'approve' });
    await expect(p).resolves.toMatchObject({ decision: 'approve' }); expect(a.ctl.state.approvals).toHaveLength(0);
  });
  it('answering on the owner screen first withdraws it: the first answer wins and the late teammate answer changes nothing', async () => {
    const { a, b } = await setup(true); const p = ask(a.ctl, 'ap_2'); await until(() => b.bridge.remote!.waiting().length === 1, 60000);
    a.ctl.answerApproval('deny'); await expect(p).resolves.toMatchObject({ decision: 'deny' });
    await b.bridge.remote!.decide(b.bridge.remote!.waiting()[0]?.approvalId ?? 'apr_x', { decision: 'approve' }).catch(() => undefined); expect(a.ctl.state.approvals).toHaveLength(0);
  });
  it('without askTeammates nothing leaves the screen', async () => {
    const { a, b } = await setup(false); const p = ask(a.ctl, 'ap_3'); await new Promise((x) => setTimeout(x, 400)); expect(b.bridge.remote!.waiting()).toHaveLength(0); a.ctl.answerApproval('approve'); await expect(p).resolves.toMatchObject({ decision: 'approve' });
  });
});
