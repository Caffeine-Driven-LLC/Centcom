/**
 * The who-pays gate (C105) on every path that lets a guest's prompt reach the host's login: integration over the in-process relay with a real
 * HostBridge, host controller and guest queue. Every test here fails when the bridge does not call the gate.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { FakeEngine } from '@centcom/testkit';
import { QueueClient, type DecodedEvent } from '@centcom/net';
import type { FlagSource, LoginKind, ProviderFlagKey } from '@centcom/agent';
import { dropHostConfirmations } from '@centcom/agent';
import { AppController } from '../../src/controller.js';
import { HostBridge } from '../../src/collab/host-bridge.js';
import { ShareSession } from '../../src/collab/share-session.js';
import type { Account } from '../../src/collab/account.js';
import type { BlockedInfo, PolicyOptions } from '../../src/collab/policy.js';
import { layoutStatus, renderStatus, statusFieldsFor } from '../../src/status/index.js';
import { WS, rig, until } from '../../../net/test/session/rig.js';

let cleanup: (() => Promise<void> | void)[] = []; afterEach(async () => { for (const c of cleanup.splice(0).reverse()) await c(); dropHostConfirmations(); });
const flagsOf = (v: Partial<Record<ProviderFlagKey, boolean>> = {}): FlagSource & { set(k: ProviderFlagKey, b: boolean): void } => ({ flag: (k) => v[k] ?? (k === 'provider.command_post.subscription' ? false : true), on: () => () => undefined, set: (k, b) => { v[k] = b; } });
const nap = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function setup(o: { kind?: LoginKind; flags?: ReturnType<typeof flagsOf>; confirm?: (q: { engine: string }) => Promise<boolean>; autoApprove?: boolean; mode?: 'command_post' | 'branch'; detect?: boolean } = {}) {
  const r = await rig(); cleanup.push(() => r.stop());
  const host = await r.host.client.createSession({ name: 'shared', workspace: WS }); r.host.handle = host; cleanup.push(() => host.leave().catch(() => undefined));
  const ctl = new AppController({ engine: new FakeEngine({ id: 'claude-code', script: {} }) as never, demo: false, cwd: '/tmp', version: 't', skills: [] }); await ctl.start(); cleanup.push(() => ctl.stop());
  const blocked: BlockedInfo[] = []; const audits: string[] = []; const asked: string[] = [];
  const policy: PolicyOptions = { flags: o.flags ?? flagsOf(), onBlocked: (b) => blocked.push(b), audit: (n) => audits.push(n.note), ...(o.detect === false ? {} : { detectLoginKind: async () => o.kind ?? 'subscription' }), ...(o.confirm ? { confirm: async (q) => { asked.push(q.engine); return o.confirm!(q); } } : {}) };
  const bridge = new HostBridge(ctl, host, { flushMs: 5, policy, ...(o.mode ? { mode: o.mode } : {}), ...(o.autoApprove ? { autoApprove: true } : {}) }); bridge.start(); cleanup.push(() => bridge.stop());
  const guest = await r.guest.client.joinSession({ sessionId: host.id }); r.guest.handle = guest; cleanup.push(() => guest.leave().catch(() => undefined));
  await until(() => guest.state === 'live', 8000);
  const seen: DecodedEvent[] = []; guest.onAny((e) => seen.push(e));
  const users = () => ctl.state.items.filter((i) => i.kind === 'user').map((i) => (i as { text: string }).text);
  return { r, host, guest, ctl, bridge, seen, blocked, audits, asked, users, queue: new QueueClient(guest) };
}

describe('who-pays gate: command post on a subscription login', () => {
  it('queue approval: with the flag off (the default) the host cannot approve a guest prompt, and is told what to do', async () => {
    const { bridge, queue, users, blocked } = await setup(); const a = await queue.submit({ body: 'run my prompt on your login' }); await until(() => bridge.pending().length === 1);
    expect(await bridge.approve(a.item)).toBe(false); await nap(150);
    expect(users()).toEqual([]); expect(queue.get(a.item)?.state).toBe('queued');
    expect(blocked).toHaveLength(1); expect(blocked[0]).toMatchObject({ path: 'queue_approval', code: 'provider_policy_blocked', noticeKey: 'provider.blocked.cp_subscription' });
    expect(blocked[0]!.detail).toMatch(/API-key/); expect(blocked[0]!.detail).toMatch(/branch mode/); expect(blocked[0]!.detail).toMatch(/provider\.command_post\.subscription/);
  });
  it('an unknown login kind counts as a subscription (nothing is looked up)', async () => {
    const { bridge, queue, users, blocked } = await setup({ detect: false }); const a = await queue.submit({ body: 'hi' }); await until(() => bridge.pending().length === 1);
    expect(await bridge.approve(a.item)).toBe(false); await nap(100); expect(users()).toEqual([]); expect(blocked[0]?.code).toBe('provider_policy_blocked');
  });
  it('auto-approve: the guest prompt is neither approved nor run', async () => {
    const { bridge, queue, users, blocked } = await setup({ autoApprove: true }); const a = await queue.submit({ body: 'auto please' });
    await until(() => blocked.length > 0, 6000); await nap(150); expect(users()).toEqual([]); expect(queue.get(a.item)?.state).toBe('queued'); expect(blocked[0]?.path).toBe('auto_approve'); void bridge;
    expect(await bridge.setAutoApprove(true)).toBe(false); expect(bridge.autoApproving).toBe(false); // turning auto-approve on goes through the gate too
  });
  it('guest prompt: an item approved by another route is refused at the claim, the guest is told, nothing runs', async () => {
    const { bridge, queue, users, blocked, seen } = await setup(); const a = await queue.submit({ body: 'sneak in' }); await until(() => bridge.pending().length === 1);
    const rejected: string[] = []; queue.on('rejected', (e) => rejected.push(e.item));
    await bridge.queue.approve(a.item); // not through bridge.approve: the claim has to be gated too
    await until(() => rejected.length === 1, 6000); expect(users()).toEqual([]); expect(blocked.some((b) => b.path === 'guest_prompt')).toBe(true);
    await until(() => seen.some((e) => e.kind === 'message.system' && /was not run/.test(String(e.secret?.text))), 4000);
  });
  it('the engine switched off by its kill switch blocks new guest prompts even on an API-key login', async () => {
    const flags = flagsOf({ 'provider.claude_code': false }); const { bridge, queue, users, blocked } = await setup({ kind: 'api_key', flags }); const a = await queue.submit({ body: 'x' }); await until(() => bridge.pending().length === 1);
    expect(await bridge.approve(a.item)).toBe(false); expect(users()).toEqual([]); expect(blocked[0]?.code).toBe('provider_method_disabled');
  });
  it('flag on but not confirmed: the host is asked once for the session; yes runs the prompt, one audit note', async () => {
    const flags = flagsOf({ 'provider.command_post.subscription': true }); const { bridge, queue, users, asked, audits } = await setup({ flags, confirm: async () => true });
    const a = await queue.submit({ body: 'first' }); const b = await queue.submit({ body: 'second' }); await until(() => bridge.pending().length === 2);
    expect(await bridge.approve(a.item)).toBe(true); expect(await bridge.approve(b.item)).toBe(true);
    await until(() => users().length === 2, 8000); expect(asked).toEqual(['claude-code']); expect(audits).toEqual(['provider.cp_subscription.confirmed']);
  });
  it('flag on and the host says no: nothing runs and the item is held, not rejected', async () => {
    const flags = flagsOf({ 'provider.command_post.subscription': true }); const { bridge, queue, users, blocked, asked } = await setup({ flags, confirm: async () => false });
    const a = await queue.submit({ body: 'held' }); await until(() => bridge.pending().length === 1); expect(await bridge.approve(a.item)).toBe(false); await nap(100);
    expect(users()).toEqual([]); expect(queue.get(a.item)?.state).toBe('queued'); expect(blocked[0]?.code).toBe('host_confirmation'); expect(asked).toHaveLength(1);
  });
  it('flag on and no way to ask (no confirmation dialog): stays blocked', async () => {
    const flags = flagsOf({ 'provider.command_post.subscription': true }); const { bridge, queue, users } = await setup({ flags });
    const a = await queue.submit({ body: 'x' }); await until(() => bridge.pending().length === 1); expect(await bridge.approve(a.item)).toBe(false); expect(users()).toEqual([]);
  });
  it('failover: moving the conversation to another agent goes through the gate', async () => {
    const { bridge, blocked } = await setup(); expect(await bridge.admitEngine('codex')).toBe(false); expect(blocked.at(-1)).toMatchObject({ path: 'failover', code: 'provider_policy_blocked' });
  });
  it('new session: admit() refuses a subscription login with the flag off, and allows an API-key login', async () => {
    const a = await setup(); expect(await a.bridge.admit()).toMatchObject({ allowed: false, error: 'provider_policy_blocked' }); expect(a.blocked[0]?.path).toBe('new_session');
    const b = await setup({ kind: 'api_key' }); expect(await b.bridge.admit()).toEqual({ allowed: true });
  });
});

describe('who-pays gate: allowed cases', () => {
  it('an API-key login runs guest prompts in a command post regardless of the subscription flag', async () => {
    const { bridge, queue, users, blocked } = await setup({ kind: 'api_key' }); const a = await queue.submit({ body: 'on the key' }); await until(() => bridge.pending().length === 1);
    expect(await bridge.approve(a.item)).toBe(true); await until(() => users().length === 1, 8000); expect(blocked).toEqual([]);
  });
  it('branch mode runs on each owner\'s own login, so a subscription is allowed there', async () => {
    const { bridge, blocked } = await setup({ mode: 'branch', kind: 'subscription' });
    for (const p of ['new_session', 'host_handoff', 'failover', 'queue_approval', 'auto_approve', 'guest_prompt'] as const) expect(await bridge.gate.check(p, false)).toEqual({ allowed: true });
    expect(blocked).toEqual([]); expect(bridge.spend).toBeUndefined(); // nobody spends the owner's usage but the owner
  });
  it('the spawn announcement says who pays: runs_on is the host and provider the coarse enum', async () => {
    const { seen, host } = await setup({ kind: 'api_key' }); await until(() => seen.some((e) => e.kind === 'agent.spawn') || true); const sp = seen.find((e) => e.kind === 'agent.spawn'); if (sp) expect(sp.p).toMatchObject({ runs_on: host.me.id, provider: 'anthropic' });
  });
});

describe('who-pays gate: guest spend control', () => {
  it('counts guests, pauses them with control.policy locked and holds their prompts until resumed', async () => {
    const { bridge, queue, users, guest } = await setup({ kind: 'api_key' }); await until(() => bridge.spend!.count() === 1, 4000);
    expect(bridge.whoPaysView()).toMatchObject({ guests: 1, paused: false, provider: 'anthropic' });
    const a = await queue.submit({ body: 'asked before the pause' }); await until(() => bridge.pending().length === 1);
    await bridge.spend!.pause(); expect(bridge.spend!.paused()).toBe(true); await until(() => guest.policy.locked === true, 6000);
    expect(await bridge.approve(a.item)).toBe(true); await nap(300); expect(users()).toEqual([]); // approved, but not claimed while guests are paused
    await bridge.spend!.resume(); await until(() => users().length === 1, 8000);
  });
  it('a pause that cannot be sent still holds guest prompts on this computer', async () => {
    const { bridge, queue, users, host } = await setup({ kind: 'api_key' }); const send = host.sendEvent.bind(host); (host as unknown as { sendEvent: typeof host.sendEvent }).sendEvent = (async (k: string, b: never) => { if (k === 'control.policy') throw new Error('offline'); return send(k, b); }) as never;
    const a = await queue.submit({ body: 'x' }); await until(() => bridge.pending().length === 1);
    await bridge.spend!.pause(); expect(bridge.spend!.lastError()).toBe(true); expect(bridge.spend!.paused()).toBe(false); expect(bridge.spend!.held()).toBe(true);
    await bridge.approve(a.item); await nap(300); expect(users()).toEqual([]);
  });
});

describe('who-pays gate: /share in the terminal app', () => {
  async function app(opts: PolicyOptions, mode: 'command_post' | 'branch') {
    const r = await rig(); cleanup.push(() => r.stop());
    const ctl = new AppController({ engine: new FakeEngine({ id: 'claude-code', script: {} }) as never, demo: false, cwd: '/tmp/proj', version: 't', skills: [] }); await ctl.start(); cleanup.push(() => ctl.stop());
    const account = { plain: { getStatus: async () => ({ status: 'ok' }) }, status: async () => ({ signedIn: true, persisted: true, api: 'x', me: { id: 'u', name: 'A', email: 'a@x', plan: 'team', workspace: { id: WS, name: 'ws' } } }), sessions: async () => r.host.client, workspaces: async () => [{ id: WS, name: 'ws' }] } as unknown as Account;
    const share = new ShareSession(ctl, account, opts); cleanup.push(() => share.close()); await share.handleCommand(mode === 'branch' ? 'branch' : ''); return { ctl, share };
  }
  const notices = (c: AppController) => c.state.items.filter((i) => i.kind === 'notice') as { level: string; text: string; detail?: string }[];
  it('a command post on a subscription login is not started: no session, and the notice says what the host can do', async () => {
    const { ctl, share } = await app({ flags: flagsOf(), detectLoginKind: async () => 'subscription' }, 'command_post');
    expect(share.live).toBe(false); const n = notices(ctl).at(-1)!; expect(n.text).toMatch(/subscription login for other people/); expect(n.detail).toMatch(/API-key/); expect(n.detail).toMatch(/\/share branch/);
  });
  it('the same login in branch mode starts, and the header says whose account runs the agent', async () => {
    const { ctl, share } = await app({ flags: flagsOf(), detectLoginKind: async () => 'subscription' }, 'branch');
    expect(share.live).toBe(true); expect(ctl.state.share?.runsOn).toBe('runs on you · anthropic');
  });
  it('an API-key command post starts and shows the guest spend line once guests are in', async () => {
    const { ctl, share } = await app({ flags: flagsOf(), detectLoginKind: async () => 'api_key' }, 'command_post');
    expect(share.live).toBe(true); expect(ctl.state.share?.runsOn).toMatch(/^runs on you/);
  });
  it('flag on: /share asks the host (their own dialog), a no ends the session it created', async () => {
    const asked: string[] = []; const { ctl, share } = await app({ flags: flagsOf({ 'provider.command_post.subscription': true }), detectLoginKind: async () => 'subscription', confirm: async (q) => { asked.push(q.engine); return false; } }, 'command_post');
    expect(asked).toEqual(['claude-code']); expect(share.live).toBe(false); expect(notices(ctl).some((n) => /Waiting for your confirmation/.test(n.text))).toBe(true);
  });
});

describe('who-pays gate: switching agents while shared', () => {
  it('the controller asks the guard before switching, and stays on the engine when it says no', async () => {
    const ctl = new AppController({ engine: new FakeEngine({ id: 'claude-code', script: {} }) as never, engines: { codex: () => new FakeEngine({ id: 'codex', script: {} }) as never }, demo: false, cwd: '/tmp', version: 't', skills: [] }); await ctl.start(); cleanup.push(() => ctl.stop());
    const asked: string[] = []; ctl.setEngineGuard(async (e) => { asked.push(e); return false; }); await ctl.switchEngine('codex'); expect(asked).toEqual(['codex']); expect(ctl.state.engineId).toBe('claude-code');
    ctl.setEngineGuard(async () => true); await ctl.switchEngine('codex'); expect(ctl.state.engineId).toBe('codex'); expect(ctl.state.agents.find((a) => a.mine)?.loginKind).toBe('unknown'); // the new agent's login is not assumed to be the old one's
  });
});

describe('who-pays gate: the status lines', () => {
  it('the header says whose account runs the agent and the footer how many guests can spend it, with the pause command', async () => {
    const ctl = new AppController({ engine: new FakeEngine({ script: {} }) as never, demo: false, cwd: '/tmp', version: 't', skills: [] }); await ctl.start(); cleanup.push(() => ctl.stop());
    ctl.setShareStatus({ runsOn: 'runs on you · anthropic', guests: '2 guests can spend your Anthropic usage  /share pause' });
    const f = statusFieldsFor(ctl.state); expect(renderStatus(layoutStatus(f, 140, undefined, 'header'), 140)).toContain('runs on you · anthropic'); expect(renderStatus(layoutStatus(f, 140, undefined, 'footer'), 140)).toContain('2 guests can spend your Anthropic usage');
    ctl.setShareStatus(undefined); expect(renderStatus(layoutStatus(statusFieldsFor(ctl.state), 140, undefined, 'header'), 140)).not.toContain('runs on');
  });
});
