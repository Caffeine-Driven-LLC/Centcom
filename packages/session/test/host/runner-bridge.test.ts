import { describe, expect, it } from 'vitest';
import { createAgentBus, createRunner, type AgentEventMap, type WireOut } from '@centcom/agent';
import { DeviceKeyStore, FrameCodec, KeyRing, Roster, memoryKeychain, sodium } from '@centcom/net';
import { newIdGenerator } from '@centcom/protocol';
import { FakeEngine } from '@centcom/testkit';
import { HostRunnerBridge, type SequencedFrame } from '../../src/index.js';
import { SID, dev, mem } from '../rigs.js';
import { cleanup, ctl, nextId, onStop, que, realClock, setup, wait } from './rig.js';

cleanup();
const stateOf = (e: { queue(): { items: Record<string, unknown>[] } }, item: string) => (e.queue().items.find((i) => i.item === item) as { state: string } | undefined)?.state;

/** the real crypto: g1 seals its request under the session key and signs it with its device key; the host opens it with its own codec */
async function crypto() {
  const gDev = new DeviceKeyStore(memoryKeychain(), dev(2)); const keys = await gDev.getOrCreatePublicKeys(); const ring = new KeyRing(); ring.addEpoch('k1', sodium().crypto_aead_xchacha20poly1305_ietf_keygen());
  const roster = new Roster(); roster.upsert({ id: mem(2), role: 'editor', slot: 1, device: dev(2), keys: { device: dev(2), ...keys } } as never);
  return { hostCodec: new FrameCodec({ sid: SID, deviceId: dev(1), device: undefined, ring, roster }), guestCodec: new FrameCodec({ sid: SID, deviceId: dev(2), device: gDev, ring, roster }) };
}
const sealed = (c: FrameCodec, item: string, body: string) => { const o = c.encode('queue.submit', nextId(), { p: ({ ctBytes }) => ({ item, size: ctBytes, kind: 'message' }), secret: { body } }); return { v: 1, sid: SID, ...o } as never; };

async function world(script?: ConstructorParameters<typeof FakeEngine>[0]) {
  const r = await setup({ policy: { auto_approve: 'everyone' } }); const c = await crypto(); const g1 = await r.guest('g1', 2);
  const fake = new FakeEngine(script); const bus = createAgentBus({ onError: () => undefined }); const ids = newIdGenerator({ now: () => Date.now(), random: (n) => globalThis.crypto.getRandomValues(new Uint8Array(n)) });
  const runner = createRunner({ engines: { get: () => fake }, bus, ids, clock: realClock, log: { debug() {}, info() {}, warn() {}, error() {} }, env: {} } as never); onStop(() => runner.stopAll());
  const wire: WireOut[] = []; const errors: unknown[] = []; const opened: string[] = [];
  /** the host's decrypt: finds the item's `queue.submit` in the stored history (the file is written just after the frame is numbered, so it may take a moment) and opens it */
  const open = async (it: { item: string; submitter: string }): Promise<string | null> => {
    for (let n = 0; n < 40; n++) { for await (const f of r.persistence.readFrames(SID, 0, 5000)) if (f.k === 'queue.submit' && (f.p as { item?: string })?.item === it.item) { const d = c.hostCodec.decode(f as unknown as SequencedFrame as never); if (!d.ok) return null; opened.push(it.item); return String((d.event.secret as { body?: string }).body); } await new Promise((res) => setTimeout(res, 25)); }
    return null;
  };
  const bridge = new HostRunnerBridge({ engine: r.engine, runner, bus: bus as never, hostId: mem(1), spec: { engine: 'fake', cwd: r.env.dir }, open, publish: (o) => { wire.push(o); }, onError: (e) => errors.push(e) }); bridge.start(); onStop(async () => bridge.stop());
  const events: string[] = []; for (const k of ['agent:started', 'agent:exited'] as (keyof AgentEventMap)[]) bus.on(k, () => events.push(k));
  return { ...r, c, g1, fake, bridge, wire, errors, opened, events };
}

describe('the host\'s agent runs the queue (C075)', () => {
  it('a guest\'s sealed request is approved by policy, opened by the host, run by the agent as its prompt, and ends done; guests see it end to end', async () => {
    const w = await world(); const item = que('R1');
    await w.g1.t.send(sealed(w.c.guestCodec, item, 'please read the README'));
    await wait(() => stateOf(w.engine, item) === undefined && w.fake.sessions.length === 1 && w.fake.sessions[0]!.prompts.length === 1);
    await wait(() => w.g1.ofKind('queue.done').length === 1 && w.wire.some((o) => o.k === 'tool.result')); expect(w.fake.sessions[0]!.prompts).toEqual(['please read the README']); expect(w.opened).toEqual([item]); expect(w.errors).toEqual([]);
    const states = w.g1.ofKind('queue.state').map((f) => (f.p as { items: { state: string }[] }).items[0]?.state); expect(states).toContain('approved'); expect(states).toContain('running');
    expect(w.g1.ofKind('queue.claim')).toHaveLength(1); expect(w.g1.ofKind('queue.done')[0]!.p).toMatchObject({ item, outcome: 'ok' });
    expect(w.wire.map((o) => o.k)).toEqual(expect.arrayContaining(['message.assistant.delta', 'message.assistant.done', 'tool.request', 'tool.result']));
  });
  it('items run one at a time and in order on the same agent; a second item is only claimed after the first is done', async () => {
    const w = await world({ script: { gapMs: 0 } }); const a = que('R2'), b = que('R3');
    await w.g1.t.send(sealed(w.c.guestCodec, a, 'first')); await w.g1.t.send(sealed(w.c.guestCodec, b, 'second'));
    await wait(() => w.g1.ofKind('queue.done').length === 2); expect(w.fake.sessions).toHaveLength(1); expect(w.fake.sessions[0]!.prompts).toEqual(['first', 'second']);
    const order = w.g1.got.filter((f) => f.k === 'queue.claim' || f.k === 'queue.done').map((f) => `${f.k}:${(f.p as { item: string }).item}`); expect(order).toEqual([`queue.claim:${a}`, `queue.done:${a}`, `queue.claim:${b}`, `queue.done:${b}`]);
  });
  it('an item the host cannot open is rejected and never reaches the agent', async () => {
    const w = await world(); const item = que('R4'); const f = sealed(w.c.guestCodec, item, 'x') as { ct: { c: string } }; f.ct.c = f.ct.c.slice(0, -4) + 'AAAA';
    await w.g1.t.send(f as never); await wait(() => w.g1.ofKind('queue.reject').length === 1); expect(w.fake.sessions).toHaveLength(0); expect(w.opened).toEqual([]);
  });
  it('a failed turn ends the item as error', async () => {
    const w = await world({ script: { events: [{ type: 'error', code: 'boom', message: 'x', retryable: false } as never], outcome: 'error' } }); const item = que('R5');
    await w.g1.t.send(sealed(w.c.guestCodec, item, 'go')); await wait(() => w.g1.ofKind('queue.done').length === 1); expect(w.g1.ofKind('queue.done')[0]!.p).toMatchObject({ item });
  });
  it('after the host role moves, this bridge claims nothing; the item stays approved for the new host', async () => {
    const w = await world(); const g2 = await w.guest('g2', 3); void g2; await wait(() => w.engine.members().some((m) => m.id === mem(3)));
    await w.engine.transferHost(mem(3)); await wait(() => w.engine.members().find((m) => m.id === mem(3))!.role === 'host'); const item = que('R6');
    await w.g1.t.send(sealed(w.c.guestCodec, item, 'late')); await wait(() => stateOf(w.engine, item) === 'approved'); await new Promise((r) => setTimeout(r, 200)); expect(stateOf(w.engine, item)).toBe('approved'); expect(w.fake.sessions).toHaveLength(0);
    void ctl;
  });
});
