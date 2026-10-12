import { afterEach, describe, expect, it } from 'vitest';
import { FakeEngine } from '@centcom/testkit';
import { QueueClient, type DecodedEvent } from '@centcom/net';
import { AppController } from '../../src/controller.js';
import { HostBridge } from '../../src/collab/host-bridge.js';
import { WS, rig, until } from '../../../net/test/session/rig.js';

let cleanup: (() => Promise<void> | void)[] = []; afterEach(async () => { for (const c of cleanup.splice(0).reverse()) await c(); });
async function setup(o: { autoApprove?: boolean } = {}) {
  const r = await rig(); cleanup.push(() => r.stop());
  const host = await r.host.client.createSession({ name: 'shared', workspace: WS }); r.host.handle = host; cleanup.push(() => host.leave().catch(() => undefined));
  const ctl = new AppController({ engine: new FakeEngine({ script: {} }) as never, demo: false, cwd: '/tmp', version: 't', skills: [] }); await ctl.start(); cleanup.push(() => ctl.stop());
  const bridge = new HostBridge(ctl, host, { flushMs: 5, ...(o.autoApprove ? { autoApprove: true } : {}) }); bridge.start(); cleanup.push(() => bridge.stop());
  const guest = await r.guest.client.joinSession({ sessionId: host.id }); r.guest.handle = guest; cleanup.push(() => guest.leave().catch(() => undefined));
  await until(() => guest.state === 'live', 8000);
  const seen: DecodedEvent[] = []; guest.onAny((e) => seen.push(e));
  return { r, host, guest, ctl, bridge, seen, queue: new QueueClient(guest) };
}
const kinds = (xs: DecodedEvent[]) => xs.map((e) => e.kind);

describe('sharing a conversation (host side)', () => {
  it('what the host asks and the agent answers reaches the guest as session events, in order', async () => {
    const { ctl, seen } = await setup(); await ctl.submit('hello team'); await until(() => !ctl.state.busy && kinds(seen).includes('message.assistant.done'));
    const user = seen.find((e) => e.kind === 'message.user'); expect(user?.secret?.text).toBe('hello team'); expect(user?.secret?.agent_id).toMatch(/^agt_[0-9A-HJKMNP-TV-Z]{26}$/);
    const text = seen.filter((e) => e.kind === 'message.assistant.delta').sort((a, b) => Number(a.secret?.index) - Number(b.secret?.index)).map((e) => String(e.secret?.delta)).join(''); expect(text.length).toBeGreaterThan(0);
    expect(ctl.state.items.find((i) => i.kind === 'assistant' && i.text === text)).toBeTruthy(); // the guest sees exactly what the host sees
    const done = seen.find((e) => e.kind === 'message.assistant.done'); expect(done?.secret?.message_id).toMatch(/^msg_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(kinds(seen).indexOf('message.user')).toBeLessThan(kinds(seen).indexOf('message.assistant.done')); expect(seen.some((e) => e.kind === 'agent.state' && e.p?.state === 'thinking')).toBe(true);
    expect(seen.some((e) => e.kind === 'tool.request')).toBe(true); expect(seen.some((e) => e.kind === 'tool.result' && ['ok', 'error', 'denied', 'canceled'].includes(String(e.secret?.status)))).toBe(true);
  });
  it('an editor asks through the queue; the host sees it, approves it, and the agent runs it as an ordinary message', async () => {
    const { ctl, bridge, seen, queue, host } = await setup(); const asked = await queue.submit({ body: '/model opus please add tests' });
    await until(() => bridge.pending().length === 1); const req = bridge.pending()[0]!; expect(req).toMatchObject({ item: asked.item, text: '/model opus please add tests', from: expect.any(String) });
    expect(ctl.state.items.some((i) => i.kind === 'user')).toBe(false); // nothing ran before approval
    await bridge.approve(req.item); await until(() => ctl.state.items.some((i) => i.kind === 'user' && i.member !== undefined) && !ctl.state.busy);
    const u = ctl.state.items.find((i) => i.kind === 'user')!; expect(u).toMatchObject({ text: '/model opus please add tests', member: { name: expect.any(String) } }); expect(ctl.state.settings.model).not.toBe('opus'); // plain text, never a slash command
    await until(() => queue.get(asked.item)?.state === 'done'); expect(seen.find((e) => e.kind === 'message.user')?.secret?.queue_item).toBe(asked.item); expect(host.me.role).toBe('host'); expect(bridge.pending()).toHaveLength(0);
  });
  it('a request the host rejects does not run, and the guest is told', async () => {
    const { ctl, bridge, queue } = await setup(); const a = await queue.submit({ body: 'delete everything' }); await until(() => bridge.pending().length === 1);
    const rejected: string[] = []; queue.on('rejected', (e) => rejected.push(e.item)); await bridge.reject(a.item, 'unsafe'); await until(() => rejected.length === 1); expect(ctl.state.items.some((i) => i.kind === 'user')).toBe(false);
  });
  it('with auto-approve an editor\'s request runs without the host doing anything, one after another', async () => {
    const { ctl, queue, seen } = await setup({ autoApprove: true }); const a = await queue.submit({ body: 'first' }); const b = await queue.submit({ body: 'second' });
    await until(() => queue.get(a.item)?.state === 'done' && queue.get(b.item)?.state === 'done', 8000); expect(ctl.state.items.filter((i) => i.kind === 'user').map((i) => (i as { text: string }).text)).toEqual(['first', 'second']);
    expect(seen.filter((e) => e.kind === 'message.user').map((e) => e.secret?.text)).toEqual(['first', 'second']);
  });
});
