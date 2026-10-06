import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { cleanText, encodeTxt, parseTxt, truncateUtf8, TXT_KEYS, type TxtRecord } from '../../src/index.js';

export const REC: TxtRecord = { v: '1', p: '1', sid: 'ses_01JA3Z8K2M5N7P9Q0R1S2T3V4W', name: 'Fix the relay', host: 'maya', fp: 'TV2Q-DT6H-VGRO', n: 1, pair: true };
const entries = (o: Record<string, string>) => Object.entries(o).map(([k, v]) => Buffer.from(`${k}=${v}`));
const base = { v: '1', p: '1', sid: REC.sid, name: 'x', host: 'y', fp: REC.fp, n: '2', pair: '1' };

describe('encodeTxt / parseTxt', () => {
  it('round trips and emits exactly the 8 documented keys, each entry <= 255 bytes (acceptance 1)', () => {
    const e = encodeTxt(REC); expect(e.map((b) => b.toString().split('=')[0])).toEqual([...TXT_KEYS]);
    for (const b of e) expect(b.length).toBeLessThanOrEqual(255);
    expect(parseTxt(e)).toEqual(REC);
  });
  it('a 100-character multibyte name is cut to <= 40 characters on a code point boundary; control characters go (acceptance 2)', () => {
    const name = '🚀é\u0007‮ab'.repeat(25); const e = encodeTxt({ ...REC, name }); const back = parseTxt(e)!;
    expect([...back.name].length).toBeLessThanOrEqual(40); expect(back.name).not.toMatch(/[\u0000-\u001f\u007f‮]/); expect(back.name.startsWith('🚀éab🚀')).toBe(true);
    expect(Buffer.from(back.name).toString()).toBe(back.name); // no broken UTF-8
    expect(e[3]!.length).toBeLessThanOrEqual(255);
    expect(cleanText('a\u0000b\u009fc\ud800d')).toBe('abcd'); expect(truncateUtf8('é🚀x', 5)).toBe('é'); expect(truncateUtf8('abc', 10)).toBe('abc');
  });
  it('refuses to encode invalid fields', () => {
    expect(() => encodeTxt({ ...REC, sid: 'ses_bad' })).toThrow(TypeError); expect(() => encodeTxt({ ...REC, fp: 'abcd' })).toThrow(TypeError);
    expect(() => encodeTxt({ ...REC, n: 9 })).toThrow(TypeError); expect(() => encodeTxt({ ...REC, p: '2' })).toThrow(TypeError);
  });
  it('ignores records with v=2 only, a missing sid, n=99, a non-ses sid, a bad fp or an entry over 255 bytes (acceptance 5)', () => {
    expect(parseTxt(entries(base))).not.toBeNull();
    expect(parseTxt(entries({ ...base, v: '2' }))).toBeNull();
    const { sid: _s, ...noSid } = base; expect(parseTxt(entries(noSid))).toBeNull();
    expect(parseTxt(entries({ ...base, n: '99' }))).toBeNull(); expect(parseTxt(entries({ ...base, n: '-1' }))).toBeNull(); expect(parseTxt(entries({ ...base, n: '2.5' }))).toBeNull();
    expect(parseTxt(entries({ ...base, sid: 'usr_01JA3Z8K2M5N7P9Q0R1S2T3V4W' }))).toBeNull(); expect(parseTxt(entries({ ...base, fp: 'tv2q-dt6h-vgro' }))).toBeNull();
    expect(parseTxt(entries({ ...base, p: '2,3' }))).toBeNull(); expect(parseTxt(entries({ ...base, pair: 'yes' }))).toBeNull();
    expect(parseTxt([...entries(base), Buffer.alloc(256, 0x61)])).toBeNull();
  });
  it('tolerates unknown keys and upper-case keys; first occurrence wins; p may list more protocols', () => {
    const r = parseTxt([...entries({ ...base, p: '1,2' }), Buffer.from('X-Extra=1'), Buffer.from('SID=ses_01JA3Z8K2M5N7P9Q0R1S2T3V4X'), Buffer.from('flag')]);
    expect(r?.sid).toBe(REC.sid); expect(r?.p).toBe('1,2');
  });
  it('fuzz: 10 000 random TXT sets never throw', () => {
    fc.assert(fc.property(fc.array(fc.oneof(fc.uint8Array({ maxLength: 300 }), fc.string().map((s) => Buffer.from(s)), fc.constantFrom(...entries(base))), { maxLength: 20 }), (bufs) => { const r = parseTxt(bufs); expect(r === null || typeof r.sid === 'string').toBe(true); }), { numRuns: 10_000 });
    expect(parseTxt('nope' as unknown as Uint8Array[])).toBeNull(); expect(parseTxt([1 as unknown as Uint8Array])).toBeNull();
  });
});
