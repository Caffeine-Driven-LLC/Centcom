import { afterEach, describe, expect, it } from 'vitest';
import { validateAgainst } from '@centcom/protocol';
import { dev, makeServer, mem, msg, rawClient, reaction, tk, type Who } from './helpers.js';

const stops: (() => Promise<void>)[] = []; afterEach(async () => { for (const s of stops.splice(0)) await s(); });
const boot = async (extra: Record<string, Who> = {}) => { const h = makeServer(); h.tokens.set(tk('tok-A'), { memberId: mem(2), deviceId: dev(2), name: 'Ada', role: 'editor' }); h.tokens.set(tk('tok-B'), { memberId: mem(3), deviceId: dev(3), name: 'Bo', role: 'editor' }); for (const [k, v] of Object.entries(extra)) h.tokens.set(k, v); const { port } = await h.srv.start(); stops.push(() => h.srv.stop()); return { ...h, port }; };

describe('hello and welcome (acceptance 1)', () => {
  it('a valid token gets a welcome with protocol 1, heartbeat, limits and the lowest free slot, and the welcome fits the envelope schema', async () => {
    const { port } = await boot(); const a = await rawClient(port); a.hello(tk('tok-A')); await a.wait(() => !!a.welcomed()); const w = a.welcomed()!; expect(validateAgainst('envelope', w, 'strict').ok).toBe(true); expect(w.p).toMatchObject({ protocol: 1, heartbeat: { ping_ms: 20000, dead_ms: 50000 }, limits: { max_frame: 262144 }, member: { id: mem(2), name: 'Ada', slot: 1, role: 'editor' }, caps: ['resume'] });
    const b = await rawClient(port); b.hello(tk('tok-B')); await b.wait(() => !!b.welcomed()); expect(b.welcomed()!.p.member.slot).toBe(2); expect(a.byType('control')[0]!.k).toBe('control.member_joined'); a.close(); b.close();
  });
  it('the host member takes slot 0; a returning member keeps being recognised; unknown protocols are refused', async () => {
    const { port } = await boot(); const bad = await rawClient(port); bad.hello(tk('tok-A'), null, { protocols: [9] }); await bad.wait(() => bad.closed()); expect(bad.closes).toEqual([4400]);
  });
});
describe('closing (acceptance 2)', () => {
  it('no hello within 5 s closes 4408', async () => { const { port, clock } = await boot(); const c = await rawClient(port); await clock.advance(4900); expect(c.closed()).toBe(false); await clock.advance(200); await c.wait(() => c.closed()); expect(c.closes).toEqual([4408]); });
  it('an invalid token gets sys.error then 4401; a revoked member 4403', async () => {
    const { port } = await boot({ [tk('tok-R')]: { memberId: mem(9), deviceId: dev(9), name: 'Rex', role: 'editor', revoked: true } }); const a = await rawClient(port); a.hello(tk('nope')); await a.wait(() => a.closed()); expect(a.byType('sys.error')[0]!.p).toMatchObject({ code: 'ticket_invalid' }); expect(a.closes).toEqual([4401]);
    const r = await rawClient(port); r.hello(tk('tok-R')); await r.wait(() => r.closed()); expect(r.closes).toEqual([4403]); expect(r.welcomed()).toBeUndefined();
  });
  it('a second connection of the same member and device supersedes the first: sys.bye and 4409', async () => {
    const { port } = await boot(); const a = await rawClient(port); a.hello(tk('tok-A')); await a.wait(() => !!a.welcomed()); const b = await rawClient(port); b.hello(tk('tok-A')); await b.wait(() => !!b.welcomed()); await a.wait(() => a.closed()); expect(a.byType('sys.bye')[0]!.p).toMatchObject({ reason: 'superseded' }); expect(a.closes).toEqual([4409]); expect(b.closed()).toBe(false); b.close();
  });
  it('anything before sys.hello other than pairing is a protocol violation', async () => { const { port } = await boot(); const c = await rawClient(port); c.send(reaction(msg(5))); await c.wait(() => c.closed()); expect(c.closes).toEqual([4400]); });
});
describe('limits on who comes in (acceptance 8)', () => {
  it('the 9th member is refused with an error and a close; never more than 8 live', async () => {
    const h = makeServer(); for (let i = 2; i <= 12; i++) h.tokens.set(tk(`t${i}`), { memberId: mem(i), deviceId: dev(i), name: `M${i}`, role: 'editor' }); const { port } = await h.srv.start(); stops.push(() => h.srv.stop()); const cs = []; for (let i = 2; i <= 9; i++) { const c = await rawClient(port); c.hello(tk(`t${i}`)); await c.wait(() => !!c.welcomed()); cs.push(c); }
    expect(h.srv.members()).toHaveLength(8); const nine = await rawClient(port); nine.hello(tk('t10')); await nine.wait(() => nine.closed()); expect(nine.byType('sys.error')[0]!.p).toMatchObject({ code: 'session_full' }); expect(nine.closes).toEqual([4403]); expect(h.srv.members()).toHaveLength(8); for (const c of cs) c.close();
  });
});
