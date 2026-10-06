import { describe, expect, it } from 'vitest';
import { VirtualClock } from '@centcom/testkit';
import { CODE_ALPHABET, CodeSlot, generatePairingCode, MAX_CODE_ATTEMPTS, normalizeCode } from '../../src/index.js';

describe('pairing codes (acceptance 1)', () => {
  it('the alphabet is A-Z and 2-9 without 0 O 1 I L (31 symbols)', () => {
    expect(CODE_ALPHABET).toHaveLength(31); for (const ch of '0O1IL') expect(CODE_ALPHABET).not.toContain(ch);
    expect(new Set(CODE_ALPHABET).size).toBe(31);
  });
  it('codes are 8 symbols of the alphabet, displayed ABCD-EFGH', () => {
    for (let i = 0; i < 500; i++) { const { code, display } = generatePairingCode(); expect(code).toMatch(/^[A-HJKMNP-Z2-9]{8}$/); expect(display).toBe(`${code.slice(0, 4)}-${code.slice(4)}`); }
  });
  it('10 000 codes are roughly uniform (chi-square p > 0.001, df 30)', () => {
    const counts = new Map<string, number>(); let n = 0;
    for (let i = 0; i < 10_000; i++) for (const ch of generatePairingCode().code) { counts.set(ch, (counts.get(ch) ?? 0) + 1); n++; }
    const expected = n / 31; let chi = 0; for (const ch of CODE_ALPHABET) chi += ((counts.get(ch) ?? 0) - expected) ** 2 / expected;
    expect(counts.size).toBe(31); expect(chi).toBeLessThan(59.7); // critical value of chi-square with 30 degrees of freedom at p = 0.001
  });
  it('rejection sampling: bytes >= 248 are skipped, so a biased-looking rng still gives valid codes', () => {
    let i = 0; const seq = [255, 248, 0, 30, 31, 247]; const { code } = generatePairingCode(() => Uint8Array.of(seq[i++ % seq.length]!));
    expect(code).toBe('A9A9A9A9'); // 0 -> A, 30 -> 9, 31 -> A, 247 -> 9; 255 and 248 are skipped
    expect(() => generatePairingCode(() => new Uint8Array(0))).toThrow(RangeError);
    expect(() => generatePairingCode(() => Uint8Array.of(255))).toThrow(RangeError);
  });
  it('normalizeCode', () => {
    expect(normalizeCode('abcd-efgh')).toBe('ABCDEFGH'); expect(normalizeCode(' ABCD EFGH ')).toBe('ABCDEFGH');
    for (const bad of ['ABCD-EFG0', 'ABCDEFGI', 'abcd-efgl', 'ABCDEFG', 'ABCDEFGHJ', 'ABCD_EFGH', '', 'Ä'.repeat(8), 'x'.repeat(100)]) expect(normalizeCode(bad), bad).toBeNull();
    expect(normalizeCode(42 as unknown as string)).toBeNull();
  });
});

describe('code slot: expiry and attempts', () => {
  it('valid 5 minutes, then expired; consumed after one use; 5 failures invalidate', () => {
    const clock = new VirtualClock(); const s = new CodeSlot(clock);
    expect(s.current()).toEqual({ ok: false, reason: 'expired' });
    const o = s.open(); expect(o.display).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/); expect(o.expiresAt).toBe(new Date(clock.now() + 300_000).toISOString());
    expect(s.current().ok).toBe(true);
    for (let i = 1; i < MAX_CODE_ATTEMPTS; i++) expect(s.fail()).toBe(false);
    expect(s.fail()).toBe(true); expect(s.current()).toEqual({ ok: false, reason: 'too_many' }); expect(s.failures()).toBe(5);
    s.open(); expect(s.current().ok).toBe(true); s.consume(); expect(s.current()).toEqual({ ok: false, reason: 'expired' });
    s.open(1000); s.close(); expect(s.current().ok).toBe(false);
  });
  it('expiry at exactly 5 min still valid, 5 min + 1 ms not', async () => {
    const clock = new VirtualClock(); const s = new CodeSlot(clock); s.open();
    await clock.advance(300_000); expect(s.current().ok).toBe(true); await clock.advance(1); expect(s.current()).toEqual({ ok: false, reason: 'expired' });
  });
});
