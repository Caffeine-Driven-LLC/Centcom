import { beforeAll, describe, expect, it } from 'vitest';
import { calculateGenerator, confirmMac, cpaceStart, ctEqual, deriveIsk, generatorString, initCpace, lanChannelId, lvCat, prependLen, scalarMult, scalarMultVfy, transcriptIr, DSI, IDENTITY } from '../../src/pairing/cpace.js';
import { sampleScalar } from '../../src/pairing/cpace.js';

const hex = (s: string) => Uint8Array.from(Buffer.from(s.replace(/\s+/g, ''), 'hex'));
const toHex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const ascii = (s: string) => new TextEncoder().encode(s);

/** draft-irtf-cfrg-cpace-15, Appendix B.3 (CPACE-RISTR255-SHA512). */
const V = {
  PRS: ascii('Password'),
  CI: hex('6f630b425f726573706f6e6465720b415f696e69746961746f72'),
  sid: hex('7e4b4791d6a8ef019b936c79fb7f2c57'),
  genStr: hex(`11435061636552697374726574746f3235350850617373776f726464
    00000000000000000000000000000000000000000000000000000000
    00000000000000000000000000000000000000000000000000000000
    00000000000000000000000000000000000000000000000000000000
    000000000000000000000000000000001a6f630b425f726573706f6e
    6465720b415f696e69746961746f72107e4b4791d6a8ef019b936c79
    fb7f2c57`),
  g: hex('a6fc82c3b8968fbb2e06fee81ca858586dea50d248f0c7ca6a18b0902a30b36b'),
  ya: hex('da3d23700a9e5699258aef94dc060dfda5ebb61f02a5ea77fad53f4ff0976d08'), ADa: ascii('ADa'),
  Ya: hex('d40fb265a7abeaee7939d91a585fe59f7053f982c296ec413c624c669308f87a'),
  yb: hex('d2316b454718c35362d83d69df6320f38578ed5984651435e2949762d900b80d'), ADb: ascii('ADb'),
  Yb: hex('08bcf6e9777a9c313a3db6daa510f2d398403319c2341bd506a92e672eb7e307'),
  K: hex('e22b1ef7788f661478f3cddd4c600774fc0f41e6b711569190ff88fa0e607e09'),
  transcriptIr: hex(`20d40fb265a7abeaee7939d91a585fe59f7053f982c296ec413c624c
    669308f87a034144612008bcf6e9777a9c313a3db6daa510f2d39840
    3319c2341bd506a92e672eb7e30703414462`),
  ISK_IR: hex(`4c5469a16b2364c4b944ebc1a79e51d1674ad47db26e8718154f59fa
    ebfaa52d8346f30aa58377117eb20d527f2cbc5c76381f7fd372e89d
    f8239f87f2e02ed1`),
  s: hex('7cd0e075fa7955ba52c02759a6c90dbbfc10e6d40aea8d283e407d88cf538a05'),
  X: hex('2c3c6b8c4f3800e7aef6864025b4ed79bd599117e427c41bd47d93d654b4a51c'),
  sX: hex('7c13645fe790a468f62c39beb7388e541d8405d1ade69d1778c5fe3e7f6b600e'),
  Yi1: hex('2b3c6b8c4f3800e7aef6864025b4ed79bd599117e427c41bd47d93d654b4a51c'),
};

beforeAll(async () => { await initCpace(); });

describe('string helpers (draft Appendix A)', () => {
  it('prepend_len and lv_cat vectors', () => {
    expect(toHex(prependLen(new Uint8Array(0)))).toBe('00');
    expect(toHex(prependLen(ascii('1234')))).toBe('0431323334');
    expect(toHex(prependLen(Uint8Array.from({ length: 127 }, (_, i) => i))).slice(0, 4)).toBe('7f00');
    expect(toHex(prependLen(Uint8Array.from({ length: 128 }, (_, i) => i))).slice(0, 6)).toBe('800100');
    expect(toHex(lvCat(ascii('1234'), ascii('5'), new Uint8Array(0), ascii('678')))).toBe('043132333401350003363738');
    expect(toHex(transcriptIr(ascii('123'), ascii('PartyA'), ascii('234'), ascii('PartyB')))).toBe('03313233065061727479410332333406506172747942');
  });
});

describe('CPACE-RISTR255-SHA512 known answers (draft Appendix B.3)', () => {
  it('generator string and generator', () => {
    expect(toHex(generatorString(DSI, V.PRS, V.CI, V.sid))).toBe(toHex(V.genStr));
    expect(toHex(calculateGenerator(V.PRS, V.CI, V.sid))).toBe(toHex(V.g));
  });
  it('messages, K and ISK (initiator/responder)', () => {
    expect(toHex(scalarMult(V.ya, V.g))).toBe(toHex(V.Ya));
    expect(toHex(scalarMult(V.yb, V.g))).toBe(toHex(V.Yb));
    expect(toHex(scalarMultVfy(V.ya, V.Yb)!)).toBe(toHex(V.K));
    expect(toHex(scalarMultVfy(V.yb, V.Ya)!)).toBe(toHex(V.K));
    const t = transcriptIr(V.Ya, V.ADa, V.Yb, V.ADb); expect(toHex(t)).toBe(toHex(V.transcriptIr));
    expect(toHex(deriveIsk(V.sid, V.K, t))).toBe(toHex(V.ISK_IR));
  });
  it('scalar_mult with valid input (B.3.10)', () => { expect(toHex(scalarMultVfy(V.s, V.X)!)).toBe(toHex(V.sX)); });
  it('rejects the identity and a non-canonical / invalid encoding (B.3.11)', () => {
    expect(scalarMultVfy(V.s, V.Yi1)).toBeNull(); expect(scalarMultVfy(V.s, IDENTITY)).toBeNull();
    const nonCanonical = new Uint8Array(32).fill(0xff); nonCanonical[31] = 0x7f; expect(scalarMultVfy(V.s, nonCanonical)).toBeNull();
    expect(scalarMultVfy(V.s, new Uint8Array(31))).toBeNull(); expect(scalarMultVfy(V.s, V.X.slice(0, 31))).toBeNull();
  });
});

describe('CT-LAN parameters', () => {
  const ci = lanChannelId('HOST-FPAA-AAAA', 'GUES-TFPA-AAAA', 'ses_01JA3Z8K2M5N7P9Q0R1S2T3V4W');
  it('CI is lv(host fp) || lv(guest fp) || lv(sid) with 2-byte big-endian lengths', () => {
    expect(toHex(ci.slice(0, 2))).toBe('000e'); expect(new TextDecoder().decode(ci.slice(2, 16))).toBe('HOST-FPAA-AAAA'); expect(toHex(ci.slice(16, 18))).toBe('000e'); expect(toHex(ci.slice(32, 34))).toBe('001e'); expect(ci.length).toBe(34 + 30);
  });
  it('same code: equal ISK; wrong code: different ISK and the confirmations do not verify', () => {
    const sid = 'ses_01JA3Z8K2M5N7P9Q0R1S2T3V4W'; const t = (own: Uint8Array, peer: Uint8Array) => transcriptIr(own, new Uint8Array(0), peer, new Uint8Array(0));
    const run = (codeA: string, codeB: string) => { const A = cpaceStart({ code: codeA, ci, sid }); const B = cpaceStart({ code: codeB, ci, sid }); return [A.finish(B.share, t), B.finish(A.share, (own, peer) => t(peer, own))] as const; };
    const [ia, ib] = run('ABCDEFGH', 'ABCDEFGH'); expect(ia).not.toBeNull(); expect(toHex(ia!)).toBe(toHex(ib!));
    const [wa, wb] = run('ABCDEFGH', 'ABCDEFGJ'); expect(toHex(wa!)).not.toBe(toHex(wb!));
    const tr = ascii('transcript'); expect(ctEqual(confirmMac(wa!, 'guest', tr), confirmMac(wb!, 'guest', tr))).toBe(false);
    expect(ctEqual(confirmMac(ia!, 'guest', tr), confirmMac(ib!, 'guest', tr))).toBe(true);
    expect(ctEqual(confirmMac(ia!, 'guest', tr), confirmMac(ia!, 'host', tr))).toBe(false);
  });
  it('a different CI (MITM between different hosts) diverges even with the right code', () => {
    const sid = 'ses_01JA3Z8K2M5N7P9Q0R1S2T3V4W'; const t = (x: Uint8Array, y: Uint8Array) => transcriptIr(x, new Uint8Array(0), y, new Uint8Array(0));
    const A = cpaceStart({ code: 'ABCDEFGH', ci, sid }); const B = cpaceStart({ code: 'ABCDEFGH', ci: lanChannelId('OTHE-RHOS-TAAA', 'GUES-TFPA-AAAA', sid), sid });
    expect(toHex(A.finish(B.share, t)!)).not.toBe(toHex(B.finish(A.share, (o, p) => t(p, o))!));
  });
  it('an invalid peer share aborts (null), and a party finishes only once', () => {
    const p = cpaceStart({ code: 'ABCDEFGH', ci, sid: 'ses_01JA3Z8K2M5N7P9Q0R1S2T3V4W' }); expect(p.finish(IDENTITY, () => new Uint8Array(0))).toBeNull();
    const q = cpaceStart({ code: 'ABCDEFGH', ci, sid: 'ses_01JA3Z8K2M5N7P9Q0R1S2T3V4W' }); expect(q.finish(p.share, () => new Uint8Array(0))).not.toBeNull(); expect(q.finish(p.share, () => new Uint8Array(0))).toBeNull();
  });
  it('sampled scalars are below 2^252 and never zero', () => {
    for (let i = 0; i < 50; i++) expect(sampleScalar()[31]! & 0xf0).toBe(0);
    let calls = 0; const s = sampleScalar((n) => (calls++ === 0 ? new Uint8Array(n) : new Uint8Array(n).fill(7))); expect(s.some((b) => b !== 0)).toBe(true); expect(calls).toBe(2);
    expect(() => sampleScalar(() => new Uint8Array(3))).toThrow(RangeError);
  });
});
