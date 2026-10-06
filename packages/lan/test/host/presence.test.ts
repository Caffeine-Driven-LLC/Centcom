import { afterEach, describe, expect, it } from 'vitest';
import { dev, makeServer, mem, msg, rawClient, tk, SID, type Who } from './helpers.js';

const stops: (() => Promise<void>)[] = []; afterEach(async () => { for (const s of stops.splice(0)) await s(); });
const boot = async (n: number) => { const h = makeServer(); for (let i = 2; i < 2 + n; i++) h.tokens.set(tk(`t${i}`), { memberId: mem(i), deviceId: dev(i), name: `M${i}`, role: 'editor' } as Who); const { port } = await h.srv.start(); stops.push(() => h.srv.stop()); return { ...h, port }; };
const join = async (port: number, i: number) => { const c = await rawClient(port); c.hello(tk(`t${i}`)); await c.wait(() => !!c.welcomed()); return c; };
const upd = (activity: string, status = 'online') => ({ v: 1, t: 'presence', sid: SID, k: 'presence.update', p: { status, activity } });
const cur = (line: number) => ({ v: 1, t: 'presence', sid: SID, k: 'presence.cursor', id: msg(line), ct: { alg: 'xchacha20poly1305', kid: 'k1', n: 'A'.repeat(32), c: 'QUJD' }, sig: 'AAAA' });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('presence (acceptance 12)', () => {
  it('five members sending 10 updates a second reach the others at most once per 500 ms each, the newest value, never sequenced', async () => {
    const { port, clock, srv } = await boot(5); const cs = []; for (let i = 2; i <= 6; i++) cs.push(await join(port, i)); const head = srv.headSeq(); const watch = cs[0]!; const got = () => watch.frames.filter((f) => f.k === 'presence.update' && f.from === mem(3));
    for (let n = 0; n < 10; n++) { cs[1]!.send(upd(n % 2 ? 'typing' : 'reviewing')); await wait(5); } await wait(100); expect(got()).toHaveLength(0); await clock.advance(501); await watch.wait(() => got().length === 1); expect(got()[0]!.p.activity).toBe('typing'); /* the last of the ten */ expect(got()[0]!.seq).toBeUndefined(); expect(srv.headSeq()).toBe(head);
    for (let n = 0; n < 10; n++) { cs[1]!.send(upd('running')); await wait(5); } await clock.advance(600); await watch.wait(() => got().length === 2); expect(got()).toHaveLength(2); expect(got()[1]!.p.activity).toBe('running'); expect(got()[0]!.from).toBe(mem(3)); expect(got()[0]!.ts).toMatch(/Z$/); for (const c of cs) c.close();
  });
  it('a presence frame over 10 a second from one member is dropped quietly', async () => { const { port, clock } = await boot(2); const a = await join(port, 2); const b = await join(port, 3); for (let n = 0; n < 40; n++) a.send(upd(n === 39 ? 'running' : 'idle')); await wait(150); await clock.advance(600); await wait(100); const seen = b.frames.filter((f) => f.k === 'presence.update'); expect(seen.length).toBe(1); expect(seen[0]!.p.activity).not.toBe('running'); expect(a.closed()).toBe(false); a.close(); b.close(); });
  it('a typing indicator that is not refreshed ends after 5 s with an idle update; a refresh keeps it', async () => {
    const { port, clock } = await boot(2); const a = await join(port, 2); const b = await join(port, 3); const seen = () => b.frames.filter((f) => f.k === 'presence.update').map((f) => f.p.activity); a.send(upd('typing')); await wait(80); await clock.advance(600); await b.wait(() => seen().length === 1); expect(seen()).toEqual(['typing']); await clock.advance(3000); a.send(upd('typing')); await wait(80); await clock.advance(600); await clock.advance(3000); await wait(50); expect(seen().at(-1)).toBe('typing'); await clock.advance(2100); await b.wait(() => seen().at(-1) === 'idle'); a.close(); b.close();
  });
  it('cursors: only the newest per member every 100 ms; a new member gets everyone\'s latest update after joining', async () => {
    const { port, clock } = await boot(3); const a = await join(port, 2); const b = await join(port, 3); a.send(upd('reviewing')); await wait(80); await clock.advance(600); for (let n = 1; n <= 9; n++) a.send(cur(n)); await wait(150); await clock.advance(101); await b.wait(() => b.frames.some((f) => f.k === 'presence.cursor')); expect(b.frames.filter((f) => f.k === 'presence.cursor')).toHaveLength(1); expect(b.frames.find((f) => f.k === 'presence.cursor')!.id).toBe(msg(9));
    const late = await join(port, 4); await late.wait(() => late.frames.some((f) => f.k === 'presence.update')); expect(late.frames.filter((f) => f.k === 'presence.update')[0]!.p.activity).toBe('reviewing'); a.close(); b.close(); late.close();
  });
});
describe('leaving', () => {
  it('a member that stays gone for 10 s is announced as left; one that comes back in time is not', async () => {
    const { port, clock } = await boot(2); const a = await join(port, 2); const b = await join(port, 3); b.close(); await wait(100); await clock.advance(9000); const left = () => a.frames.filter((f) => f.k === 'control.member_left'); expect(left()).toHaveLength(0); const b2 = await join(port, 3); await clock.advance(5000); expect(left()).toHaveLength(0); b2.close(); await wait(100); await clock.advance(10_100); await a.wait(() => left().length === 1); expect(left()[0]!.p).toMatchObject({ member: mem(3), code: 'timeout' }); expect(left()[0]!.from).toBe('srv'); a.close();
  });
});
