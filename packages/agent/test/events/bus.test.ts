import { describe, expect, it, expectTypeOf } from 'vitest';
import fc from 'fast-check';
import { BusError, createAgentBus, createBus, type AgentEventMap } from '../../src/events/index.js';

type M = { a: { n: number }; b: { n: number }; c: { n: number } };
const mk = () => { const errors: [unknown, string][] = []; const bus = createBus<M>({ onError: (e, k) => errors.push([e, k]) }); return { bus, errors }; };

describe('dispatch', () => {
  it('runs handlers in registration order', () => {
    const { bus } = mk(); const log: string[] = []; bus.on('a', () => log.push('1')); bus.on('a', () => log.push('2')); bus.on('b', () => log.push('x')); bus.on('a', () => log.push('3')); bus.emit('a', { n: 1 });
    expect(log).toEqual(['1', '2', '3']);
  });
  it('a handler added during dispatch is not called for that same emit, but is for the next', () => {
    const { bus } = mk(); const log: string[] = []; bus.on('a', () => { log.push('first'); bus.on('a', () => log.push('late')); }); bus.emit('a', { n: 1 }); expect(log).toEqual(['first']); bus.emit('a', { n: 2 }); expect(log).toEqual(['first', 'first', 'late']);
  });
  it('an emit from inside a handler is delivered after every handler of the current event returned, in FIFO order', () => {
    const { bus } = mk(); const log: string[] = [];
    bus.on('a', () => { log.push('a1'); bus.emit('b', { n: 1 }); bus.emit('c', { n: 1 }); log.push('a1-end'); }); bus.on('a', () => log.push('a2')); bus.on('b', () => { log.push('b'); bus.emit('c', { n: 2 }); }); bus.on('c', (p) => log.push('c' + p.n));
    bus.emit('a', { n: 0 }); expect(log).toEqual(['a1', 'a1-end', 'a2', 'b', 'c1', 'c2']);
  });
  it('once fires once, even for two emits in a row, and unsubscribing is idempotent', () => {
    const { bus } = mk(); let n = 0; bus.once('a', () => n++); bus.emit('a', { n: 1 }); bus.emit('a', { n: 2 }); expect(n).toBe(1); expect(bus.listenerCount('a')).toBe(0);
    const off = bus.on('a', () => n++); off(); off(); off(); bus.emit('a', { n: 3 }); expect(n).toBe(1);
    const h = () => { n += 10; }; bus.on('b', h); bus.off('b', h); bus.off('b', h); bus.emit('b', { n: 1 }); expect(n).toBe(1);
  });
  it('a handler removed by an earlier handler in the same dispatch is not called', () => {
    const { bus } = mk(); const log: string[] = []; let off2 = () => undefined as void; bus.on('a', () => { log.push('1'); off2(); }); off2 = bus.on('a', () => log.push('2')); bus.emit('a', { n: 1 }); expect(log).toEqual(['1']);
  });
  it('emitting with no listeners is a no-op', () => { const { bus, errors } = mk(); bus.emit('a', { n: 1 }); expect(errors).toEqual([]); expect(bus.listenerCount()).toBe(0); });
  it('there is no shared state between two buses', () => { const x = mk(); const y = mk(); let n = 0; x.bus.on('a', () => n++); y.bus.emit('a', { n: 1 }); expect(n).toBe(0); });
});

describe('errors', () => {
  it('a throwing handler does not stop the next ones and reaches onError once with the event name', () => {
    const { bus, errors } = mk(); const log: string[] = []; bus.on('a', () => { throw new Error('boom'); }); bus.on('a', () => log.push('after')); bus.emit('a', { n: 1 });
    expect(log).toEqual(['after']); expect(errors).toHaveLength(1); expect(errors[0]![1]).toBe('a'); expect((errors[0]![0] as Error).message).toBe('boom');
  });
  it('an async rejection reaches onError and causes no unhandled rejection', async () => {
    const unhandled: unknown[] = []; const on = (e: unknown) => unhandled.push(e); process.on('unhandledRejection', on);
    const { bus, errors } = mk(); bus.on('a', async () => { throw new Error('later'); }); bus.on('a', () => undefined); bus.emit('a', { n: 1 }); await new Promise((r) => setTimeout(r, 20)); process.off('unhandledRejection', on);
    expect(unhandled).toEqual([]); expect(errors).toHaveLength(1); expect(errors[0]![1]).toBe('a');
  });
  it('emit does not wait for async handlers', () => { const { bus } = mk(); let finished = false; bus.on('a', async () => { await new Promise((r) => setTimeout(r, 10)); finished = true; }); bus.emit('a', { n: 1 }); expect(finished).toBe(false); });
  it('an onError that throws does not break the bus', () => { const bus = createBus<M>({ onError: () => { throw new Error('sink'); } }); let n = 0; bus.on('a', () => { throw new Error('x'); }); bus.on('a', () => n++); expect(() => bus.emit('a', { n: 1 })).not.toThrow(); expect(n).toBe(1); });
  it('the 101st listener of one event reports MaxListeners once but is still registered', () => {
    const { bus, errors } = mk(); for (let i = 0; i < 100; i++) bus.on('a', () => undefined); expect(errors).toHaveLength(0);
    let hit = 0; bus.on('a', () => hit++); expect(errors).toHaveLength(1); expect(errors[0]![0]).toBeInstanceOf(BusError); expect((errors[0]![0] as BusError).code).toBe('MaxListeners'); bus.on('a', () => undefined); expect(errors).toHaveLength(1);
    bus.emit('a', { n: 1 }); expect(hit).toBe(1); expect(bus.listenerCount('a')).toBe(102); bus.on('b', () => undefined); expect(errors).toHaveLength(1); // other events have their own count
  });
  it('re-emit storm: the queue is bounded, overflow is reported once per 1000 drops, and the bus keeps working', () => {
    const errors: BusError[] = []; const bus = createBus<M>({ onError: (e) => errors.push(e as BusError), maxQueue: 50 }); let seen = 0;
    bus.on('a', () => { for (let i = 0; i < 2500; i++) bus.emit('b', { n: i }); }); bus.on('b', () => seen++); bus.emit('a', { n: 0 });
    expect(seen).toBe(50); expect(errors.map((e) => e.code)).toEqual(['BusOverflow', 'BusOverflow', 'BusOverflow']); // 2450 dropped: reported at the 1st, 1000th and 2000th
    let after = 0; bus.on('c', () => after++); bus.emit('c', { n: 1 }); expect(after).toBe(1);
  });
});

describe('properties', () => {
  it('every listener sees events in emit order, no matter how emits, subscriptions and unsubscriptions interleave', () => {
    fc.assert(fc.property(fc.array(fc.oneof(fc.record({ op: fc.constant('emit' as const), k: fc.constantFrom('a', 'b'), re: fc.boolean() }), fc.record({ op: fc.constant('sub' as const), k: fc.constantFrom('a', 'b') }), fc.record({ op: fc.constant('unsub' as const), i: fc.nat(20) })), { maxLength: 60 }), (ops) => {
      const { bus } = mk(); const subs: { k: 'a' | 'b'; seen: number[]; off: () => void; since: number }[] = []; let counter = 0; const log: { k: 'a' | 'b'; n: number }[] = [];
      for (const o of ops) {
        if (o.op === 'sub') { const s = { k: o.k as 'a' | 'b', seen: [] as number[], since: counter, off: () => undefined as void }; s.off = bus.on(s.k, (p) => { s.seen.push(p.n); if (o.k === 'a' && p.n % 7 === 0) bus.emit('b', { n: ++counter }), log.push({ k: 'b', n: counter }); }); subs.push(s); }
        else if (o.op === 'unsub') subs[o.i % Math.max(1, subs.length)]?.off(); else { const n = ++counter; log.push({ k: o.k as 'a' | 'b', n }); bus.emit(o.k as 'a' | 'b', { n }); }
      }
      for (const s of subs) { expect(s.seen).toEqual([...s.seen].sort((x, y) => x - y)); expect(new Set(s.seen).size).toBe(s.seen.length); expect(s.seen.every((n) => n > s.since)).toBe(true); }
    }), { numRuns: 300 });
  });
});

describe('types', () => {
  it('payloads are checked at compile time', () => {
    const bus = createAgentBus({ onError: () => undefined });
    // @ts-expect-error agent:exited needs agent_id and code
    bus.emit('agent:exited', {});
    // @ts-expect-error unknown event name
    bus.emit('agent:nope', {});
    bus.on('agent:state_changed', (p) => { expectTypeOf(p.agent_id).toEqualTypeOf<`agt_${string}`>(); expectTypeOf(p.since).toBeString(); });
    bus.on('agent:approval_needed', (p) => { expectTypeOf(p.risk).toEqualTypeOf<'low' | 'medium' | 'high'>(); });
    expectTypeOf<AgentEventMap['agent:exited']['code']>().toEqualTypeOf<'done' | 'error' | 'killed' | 'crash'>();
  });
  it('wire-bound payloads carry no free text or paths', async () => {
    const { WIRE_SAFE_EVENTS } = await import('../../src/events/index.js'); const ok = (v: unknown) => typeof v !== 'string' || /^(agt|apr|mem)_[0-9A-HJKMNP-TV-Z]{26}$|^\d{4}-|^(low|medium|high|allow|deny|timeout|cancel)$|^[a-z-]+$/.test(v);
    const samples: Record<string, Record<string, unknown>> = { 'agent:approval_needed': { agent_id: 'agt_01JTEST0000000000000000001', approval_id: 'apr_01JTEST0000000000000000001', risk: 'high', expires_at: '2026-10-06T00:00:00Z' }, 'agent:approval_resolved': { agent_id: 'agt_01JTEST0000000000000000001', approval_id: 'apr_01JTEST0000000000000000001', decision: 'allow' }, 'agent:state_changed': { agent_id: 'agt_01JTEST0000000000000000001', state: 'thinking', since: '2026-10-06T00:00:00Z' } };
    for (const name of WIRE_SAFE_EVENTS) expect(Object.values(samples[name]!).every(ok)).toBe(true);
  });
});

describe('speed', () => {
  it('1,000,000 emits to 3 handlers finish in under a second', () => {
    const { bus } = mk(); let n = 0; bus.on('a', () => n++); bus.on('a', () => n++); bus.on('a', () => n++); const p = { n: 1 }; const t = performance.now(); for (let i = 0; i < 1_000_000; i++) bus.emit('a', p); const ms = performance.now() - t;
    expect(n).toBe(3_000_000); expect(ms).toBeLessThan(1000);
  });
});
