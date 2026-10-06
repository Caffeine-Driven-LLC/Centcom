import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CONTRACT_VERSION, LIMITS, PROTOCOL_VERSIONS, TextError, b64u, compareVersions, displayName, formatMoney, formatRfc3339, hashString, idPrefix, isClientTooOld, isHashString, isId, isMoney, isSlug, newIdGenerator, normalizeText, nowRfc3339, parseRfc3339, userAgent, workspaceName } from '../src/index.js';

const rng = (seed = 1) => (n: number) => { const o = new Uint8Array(n); for (let i = 0; i < n; i++) { seed = (seed * 1664525 + 1013904223) >>> 0; o[i] = seed >>> 24; } return o; };

describe('ids', () => {
  it('10,000 IDs in the same millisecond strictly increase and match the format', () => {
    const g = newIdGenerator({ now: () => 1_700_000_000_000, random: rng() }); let prev = ''; for (let i = 0; i < 10_000; i++) { const id = g.next('que'); expect(id > prev).toBe(true); expect(id).toMatch(/^[a-z]{3}_[0-9A-HJKMNP-TV-Z]{26}$/); expect(id.length).toBeLessThanOrEqual(40); prev = id; }
  });
  it('stays ordered across milliseconds and when the clock steps backwards', () => {
    let t = 1000; const g = newIdGenerator({ now: () => t, random: rng(7) }); const a = g.next('msg'); t = 1001; const b = g.next('msg'); t = 500; const c = g.next('msg'); expect(a < b && b < c).toBe(true);
  });
  it('carries over when the random part overflows within a millisecond', () => {
    const g = newIdGenerator({ now: () => 5, random: () => new Uint8Array(10).fill(255) }); const a = g.next('apr'), b = g.next('apr'); expect(b > a).toBe(true);
  });
  it('knows its own: isId and idPrefix', () => {
    const id = newIdGenerator({ now: () => 1, random: rng() }).next('ses'); expect(isId('ses', id)).toBe(true); expect(isId('agt', id)).toBe(false); expect(idPrefix(id)).toBe('ses');
    expect(isId('ses', 'ses_01JA3Z8K2M5N7P9Q0R1S2T3V4I')).toBe(false); // I is not in the alphabet
    expect(idPrefix('zzz_01JA3Z8K2M5N7P9Q0R1S2T3V4W')).toBeUndefined(); expect(isId('ses', 42)).toBe(false);
  });
});

describe('time and money', () => {
  it('formats with milliseconds and a Z, from an injected clock', () => { expect(nowRfc3339({ now: () => Date.UTC(2026, 9, 5, 18, 7, 41, 123) })).toBe('2026-10-05T18:07:41.123Z'); expect(formatRfc3339(0)).toBe('1970-01-01T00:00:00.000Z'); });
  it('parses valid timestamps (with offsets) and refuses impossible ones', () => {
    expect(parseRfc3339('2026-10-05T18:07:41.123Z')).toBe(Date.UTC(2026, 9, 5, 18, 7, 41, 123)); expect(parseRfc3339('2026-10-05T20:07:41+02:00')).toBe(Date.UTC(2026, 9, 5, 18, 7, 41)); expect(parseRfc3339('2026-10-05T18:07:41.5Z')).toBe(Date.UTC(2026, 9, 5, 18, 7, 41, 500));
    for (const bad of ['2026-02-30T00:00:00Z', '2026-10-05T25:00:00Z', '2026-10-05', 'yesterday', '2026-10-05T18:07:41']) expect(parseRfc3339(bad)).toBeUndefined();
  });
  it('round-trips any instant', () => { fc.assert(fc.property(fc.integer({ min: 0, max: 4_000_000_000_000 }), (ms) => parseRfc3339(formatRfc3339(ms)) === ms)); });
  it('money is integer minor units in USD or EUR', () => { expect(isMoney({ amount: 1900, currency: 'USD' })).toBe(true); expect(isMoney({ amount: 19.5, currency: 'USD' })).toBe(false); expect(isMoney({ amount: 1, currency: 'GBP' })).toBe(false); expect(formatMoney({ amount: 1900, currency: 'USD' })).toBe('$19.00'); });
});

describe('base64url and hashes', () => {
  it('round-trips any bytes, without padding or + and /', () => { fc.assert(fc.property(fc.uint8Array({ maxLength: 200 }), (b) => { const s = b64u.encode(b); return /^[A-Za-z0-9_-]*$/.test(s) && Buffer.from(b64u.decode(s)).equals(Buffer.from(b)); })); });
  it('matches the standard encoding of a known value and rejects bad input', () => { expect(b64u.encode(new Uint8Array([251, 255, 254]))).toBe('-__-'); expect(() => b64u.decode('ab=c')).toThrow(); expect(() => b64u.decode('a')).toThrow(); expect(b64u.decode('')).toEqual(new Uint8Array()); });
  it('hash strings', () => { expect(hashString('sha256', 'ABCDEF')).toBe('sha256:abcdef'); expect(isHashString('sha256:abcdef')).toBe(true); expect(isHashString('abcdef')).toBe(false); });
});

describe('text', () => {
  it('normalises to NFC, idempotently', () => { expect(normalizeText('é', { max: 5 })).toBe('é'); fc.assert(fc.property(fc.string({ maxLength: 30 }).filter((s) => !/[\u0000-\u0008\u000B-\u001F\u007F]/.test(s) && s.length > 0), (s) => { const a = normalizeText(s, { max: 100 }); return normalizeText(a, { max: 100 }) === a; })); });
  it('rejects control characters but allows newline and tab', () => {
    for (const c of ['\u0000', '\u001b', '\u007f']) expect(() => normalizeText(`a${c}b`, { max: 10 })).toThrow(TextError);
    expect(normalizeText('a\nb\tc', { max: 10 })).toBe('a\nb\tc');
  });
  it('enforces the contract limits: 40 display, 60 workspace, 80 session', () => {
    expect(displayName('x'.repeat(40))).toHaveLength(40); expect(() => displayName('x'.repeat(41))).toThrow(/longer than 40/); expect(() => workspaceName('x'.repeat(61))).toThrow(); expect(() => displayName('')).toThrow(/empty/); expect(LIMITS.sessionName).toBe(80);
  });
  it('counts characters, not UTF-16 units', () => { expect(() => displayName('😀'.repeat(40))).not.toThrow(); expect(() => displayName('😀'.repeat(41))).toThrow(); });
  it('slugs', () => { expect(isSlug('my-team-2')).toBe(true); for (const b of ['ab', 'My-Team', 'x'.repeat(41), 'a b c']) expect(isSlug(b)).toBe(false); });
});

describe('versions', () => {
  it('builds the User-Agent exactly as the contract shows', () => { expect(userAgent({ name: 'centcom-cli', version: '1.4.2', platform: 'linux', arch: 'x64', node: '22.9.0' })).toBe(`centcom-cli/1.4.2 (contract/${CONTRACT_VERSION}; linux-x64; node/22.9.0)`); expect(PROTOCOL_VERSIONS).toEqual([1]); });
  it('orders versions like semver, including prereleases', () => {
    expect(compareVersions('1.2.0', '1.10.0')).toBe(-1); expect(compareVersions('2.0.0', '1.99.99')).toBe(1); expect(compareVersions('1.2.0', '1.2.0')).toBe(0);
    expect(compareVersions('1.2.0-rc.1', '1.2.0')).toBe(-1); expect(compareVersions('1.2.0-rc.2', '1.2.0-rc.10')).toBe(-1); expect(compareVersions('1.2.0-alpha', '1.2.0-1')).toBe(1); expect(compareVersions('1.2.0+build5', '1.2.0')).toBe(0);
    expect(() => compareVersions('one', '1.0.0')).toThrow();
  });
  it('knows when a client is too old', () => { expect(isClientTooOld('1.1.9', '1.2.0')).toBe(true); expect(isClientTooOld('1.2.0', '1.2.0')).toBe(false); expect(isClientTooOld('1.10.0', '1.2.0')).toBe(false); expect(isClientTooOld('1.2.0-rc.1', '1.2.0')).toBe(true); });
});
