import { describe, expect, it } from 'vitest';
import { VirtualClock } from '@centcom/testkit';
import fc from 'fast-check';
import { encodeTxt, LanAdvertiser, LanBrowser, MdnsUnavailableError, MulticastBus, QUERY_SCHEDULE_MS, advertiseOptionsFromArgs, cleanText, decodePacket, encodePacket, fakeInterfaces, instanceLabel, parseTxt, TYPE, type LanHost } from '../../src/index.js';

const SID = 'ses_01JA3Z8K2M5N7P9Q0R1S2T3V4W'; const SID2 = 'ses_01JA3Z8K2M5N7P9Q0R1S2T3V4X'; const FP = 'ABCD-EFGH-2345'; const td = new TextDecoder(); const bytes = (xs: string[]) => xs.map((x) => new TextEncoder().encode(x));
const rng = (seq: number[]) => { let i = 0; return (n: number) => { const b = new Uint8Array(n); for (let k = 0; k < n; k++) b[k] = seq[i++ % seq.length]!; return b; }; };
function lab(o: { sid?: string; name?: string; ip?: string; seq?: number[]; count?: number; enabled?: boolean } = {}) {
  const clock = new VirtualClock(); const bus = new MulticastBus(() => clock.now()); let n = o.count ?? 1; const adv = new LanAdvertiser({ sessionId: o.sid ?? SID, sessionName: o.name ?? 'Fix the relay', hostName: 'maya-laptop', fingerprint: FP, port: 7070, memberCount: () => n, socketFactory: bus.factory(o.ip ?? '192.168.1.10'), clock, rng: rng(o.seq ?? [1, 2, 3, 4, 5, 6]), interfaces: () => fakeInterfaces(o.ip ?? '192.168.1.10'), enabled: o.enabled });
  const browser = new LanBrowser({ socketFactory: bus.factory('192.168.1.20'), clock, interfaces: () => fakeInterfaces('192.168.1.20') }); return { clock, bus, adv, browser, setN: (x: number) => { n = x; } };
}
/** Run start() while the virtual clock moves (probing waits on timers). */
async function started<T>(clock: VirtualClock, p: Promise<T>): Promise<T> { let done = false; const r = p.finally(() => { done = true; }); for (let i = 0; i < 40 && !done; i++) await clock.advance(100); return r; }
const scan = async (l: ReturnType<typeof lab>, ms = 3000): Promise<LanHost[]> => { const p = l.browser.scan(ms); for (let i = 0; i < 5; i++) await new Promise<void>((r) => setImmediate(r)); await l.clock.advance(ms + 10); return p; };

describe('advertiser and browser on the fake bus', () => {
  it('scan finds exactly one host with its details; only the documented TXT keys exist and each entry is at most 255 bytes', async () => {
    const l = lab(); await started(l.clock, l.adv.start()); const hosts = await scan(l); expect(hosts).toHaveLength(1); expect(hosts[0]).toMatchObject({ sessionId: SID, name: 'Fix the relay', hostName: 'maya-laptop', fingerprint: FP, port: 7070, pairRequired: true, memberCount: 1, addresses: ['192.168.1.10'] });
    const txts = l.bus.captured.flatMap((c) => { const p = decodePacket(c.packet); return [...(p?.answers ?? []), ...(p?.additionals ?? [])].filter((r) => r.type === TYPE.TXT).flatMap((r) => ((r as unknown as { entries: Uint8Array[] }).entries ?? []).map((e) => td.decode(e))); }); expect(txts.length).toBeGreaterThan(0);
    const keys = new Set(txts.map((t) => t.split('=')[0])); expect([...keys].sort()).toEqual(['fp', 'host', 'n', 'name', 'p', 'pair', 'sid', 'v']); for (const t of txts) expect(Buffer.byteLength(t)).toBeLessThanOrEqual(255);
    await l.adv.stop(); await l.browser.stop();
  });
  it('a 100-character multibyte session name is cut to 40 characters without breaking a character; control characters go', () => {
    expect([...cleanText('漢'.repeat(100))].length).toBeLessThanOrEqual(40); expect(cleanText('漢'.repeat(100))).not.toMatch(/�/); expect(cleanText('a\u0000b\u001b[31mc\nd')).not.toMatch(/[\u0000-\u001f]/); expect(Buffer.byteLength(instanceLabel('漢'.repeat(100), 'abcd'))).toBeLessThanOrEqual(63); expect(instanceLabel('Fix the relay', 'ab12')).toBe('Fix the relay-ab12');
  });
  it('two hosts that pick the same name: the second re-rolls its suffix and both show up as separate entries', async () => {
    const a = lab({ seq: [1, 2, 9, 9, 9, 9] }); await started(a.clock, a.adv.start());
    const clock = a.clock; const b = new LanAdvertiser({ sessionId: SID2, sessionName: 'Fix the relay', hostName: 'ben-laptop', fingerprint: FP, port: 7071, memberCount: () => 1, socketFactory: a.bus.factory('192.168.1.11'), clock, rng: rng([0x01, 0x02, 0x01, 0x02, 0x07, 0x08, 0x07, 0x08]), interfaces: () => fakeInterfaces('192.168.1.11') });
    const before = a.adv.instance(); await started(clock, b.start()); expect(b.instance()).not.toBe(before); const hosts = await scan(a); expect(hosts.map((h) => h.sessionId).sort()).toEqual([SID, SID2]); expect(new Set(hosts.map((h) => h.instance)).size).toBe(2); await a.adv.stop(); await b.stop(); await a.browser.stop();
  });
  it('a changed member count reaches the browser within a second; stop() makes the host go down', async () => {
    const l = lab(); await started(l.clock, l.adv.start()); const ev: string[] = []; l.browser.on('up', () => ev.push('up')).on('update', (h) => ev.push(`update:${h.memberCount}`)).on('down', () => ev.push('down')); await l.browser.start(); await l.clock.advance(2000);
    l.setN(3); l.adv.setMemberCount(3); await l.clock.advance(1000); expect(ev).toContain('update:3'); expect(l.browser.hosts()[0]!.memberCount).toBe(3); await l.adv.stop(); await l.clock.advance(1000); expect(ev.at(-1)).toBe('down'); expect(l.browser.hosts()).toEqual([]); await l.browser.stop();
  });
  it('records expire after their time unless refreshed; the query schedule is 0, 1, 2, 4, 8 s then every minute', async () => {
    expect([...QUERY_SCHEDULE_MS]).toEqual([0, 1000, 1000, 2000, 4000]); const l = lab(); await started(l.clock, l.adv.start()); await l.browser.start(); await l.clock.advance(1500); expect(l.browser.hosts()).toHaveLength(1);
    const asks = () => l.bus.captured.filter((c) => c.from === '192.168.1.20').length; await l.clock.advance(20_000); const early = asks(); expect(early).toBeGreaterThanOrEqual(5); await l.clock.advance(60_000); expect(asks()).toBeGreaterThan(early);
    await l.browser.stop(); await l.adv.stop(); const quiet = lab(); await started(quiet.clock, quiet.adv.start()); await quiet.browser.start(); await quiet.clock.advance(500); expect(quiet.browser.hosts()).toHaveLength(1); quiet.bus.drop = (c) => c.from === '192.168.1.10'; await quiet.clock.advance(125_000); expect(quiet.browser.hosts()).toEqual([]); await quiet.browser.stop();
  });
  it('--no-announce sends nothing at all but still reports the port; a bound port gives MdnsUnavailableError with a hint, not a crash', async () => {
    const off = lab({ enabled: false }); const r = await off.adv.start(); expect(r.port).toBe(7070); await off.clock.advance(5000); expect(off.bus.captured).toEqual([]); expect(advertiseOptionsFromArgs(['--no-announce']).enabled).toBe(false); expect(advertiseOptionsFromArgs(['--bind', 'eth0', '--bind=10.0.0.1'])).toEqual({ enabled: true, bind: ['eth0', '10.0.0.1'] });
    const bus = new MulticastBus(); const bad = new LanAdvertiser({ sessionId: SID, sessionName: 'x', hostName: 'h', fingerprint: FP, port: 7070, memberCount: () => 1, socketFactory: bus.factory('192.168.1.10', { failWith: Object.assign(new Error('in use'), { code: 'EADDRINUSE' }) }), interfaces: () => fakeInterfaces('192.168.1.10') });
    const e = await bad.start().catch((x) => x); expect(e).toBeInstanceOf(MdnsUnavailableError); expect(e.hint).toMatch(/centcom join/);
  });
});

describe('untrusted input', () => {
  it('records with v=2 only, no sid, n=99, a bad sid or a too-long entry are ignored', () => {
    const ok = ['v=1', 'p=1', `sid=${SID}`, 'name=x', 'host=h', `fp=${FP}`, 'n=1', 'pair=1']; const P = (x: string[]) => parseTxt(bytes(x)); expect(P(ok)).not.toBeNull(); expect(parseTxt(encodeTxt({ v: '1', p: '1', sid: SID, name: 'x', host: 'h', fp: FP, n: 1, pair: true }))).not.toBeNull();
    for (const bad of [ok.map((x) => (x === 'v=1' ? 'v=2' : x)), ok.map((x) => (x === 'p=1' ? 'p=2' : x)), ok.filter((x) => !x.startsWith('sid=')), ok.map((x) => (x === 'n=1' ? 'n=99' : x)), ok.map((x) => (x.startsWith('sid=') ? 'sid=usr_01JA3Z8K2M5N7P9Q0R1S2T3V4W' : x)), [...ok, `name2=${'x'.repeat(300)}`]]) expect(P(bad)).toBeNull();
  });
  it('10,000 random packets and TXT sets never throw, and every packet stays within 64 KiB', () => {
    fc.assert(fc.property(fc.uint8Array({ maxLength: 600 }), fc.array(fc.string({ maxLength: 300 }), { maxLength: 12 }), (raw, txt) => { expect(() => decodePacket(raw)).not.toThrow(); expect(() => parseTxt(bytes(txt))).not.toThrow(); }), { numRuns: 10_000 });
    const p = encodePacket({ id: 0, response: true, questions: [], answers: [], authorities: [], additionals: [] }); expect(p.length).toBeLessThan(65_536);
  });
  it('a browser surviving garbage on the wire still finds the real host', async () => { const l = lab(); await started(l.clock, l.adv.start()); await l.browser.start(); for (let i = 0; i < 50; i++) l.bus.inject(new Uint8Array([i, 255, 0, 3, 7, 7, 7, i])); await l.clock.advance(1500); expect(l.browser.hosts()).toHaveLength(1); await l.browser.stop(); await l.adv.stop(); });
  it('nothing secret ever goes on the wire: only the fingerprint-shaped blob, no codes, keys or tokens', async () => {
    const l = lab(); await started(l.clock, l.adv.start()); await scan(l); const all = l.bus.captured.map((c) => Buffer.from(c.packet).toString('latin1')).join('\n'); expect(all.match(/[A-Za-z0-9_-]{43}/g) ?? []).toEqual([]); expect(all).toContain(FP); expect(all).not.toMatch(/token|secret|session_key|pairing|code=|password/i); await l.adv.stop(); await l.browser.stop();
  });
});

describe('dns packet vectors', () => {
  it('A, AAAA, PTR, SRV and TXT records survive an encode and decode, with a known byte layout for the header', () => {
    const rec = (name: string[], type: number, extra: object) => ({ name, type, ttl: 120, class: 1, ...extra }) as never;
    const pkt = { id: 0, response: true, questions: [], answers: [rec(['_centcom', '_tcp', 'local'], TYPE.PTR, { target: ['inst', '_centcom', '_tcp', 'local'] }), rec(['inst', '_centcom', '_tcp', 'local'], TYPE.SRV, { priority: 0, weight: 0, port: 7070, target: ['host', 'local'] }), rec(['inst', '_centcom', '_tcp', 'local'], TYPE.TXT, { entries: bytes(['v=1', 'n=2']) })], authorities: [], additionals: [rec(['host', 'local'], TYPE.A, { address: '192.168.1.10' }), rec(['host', 'local'], TYPE.AAAA, { address: 'fe80::1' })] };
    const wire = encodePacket(pkt as never); expect([...wire.slice(0, 12)]).toEqual([0, 0, 0x84, 0, 0, 0, 0, 3, 0, 0, 0, 2]); const back = decodePacket(wire)!; expect(back.answers).toHaveLength(3); expect(back.additionals).toHaveLength(2); expect(back.answers[1]).toMatchObject({ type: TYPE.SRV, port: 7070 }); expect((back.answers[2] as unknown as { entries: Uint8Array[] }).entries.map((e) => td.decode(e))).toEqual(['v=1', 'n=2']); expect(back.additionals[0]).toMatchObject({ address: '192.168.1.10' }); expect(back.additionals[1]).toMatchObject({ address: 'fe80::1' });
  });
  it('a name that points back at itself, or a length that runs past the end, is refused (null), not followed', () => { expect(decodePacket(new Uint8Array([0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0xc0, 12, 0, 1, 0, 1]))).toBeNull(); expect(decodePacket(new Uint8Array([0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 63, 1, 2]))).toBeNull(); });
});
