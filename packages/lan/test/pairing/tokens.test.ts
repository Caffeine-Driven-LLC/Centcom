import { describe, expect, it } from 'vitest';
import { memoryKeychain } from '@centcom/net';
import { forgetGuestToken, loadGuestToken, ReconnectTokens, saveGuestToken, tokenValidator, TOKEN_RE } from '../../src/index.js';
import { GUEST_DEV, SID, setup } from './helpers.js';

const flipBit = (t: string, bit: number) => { const b = Buffer.from(t, 'base64url'); b[bit >> 3] = b[bit >> 3]! ^ (1 << (bit & 7)); return b.toString('base64url'); };

describe('reconnect tokens (acceptance 8)', () => {
  it('issue gives 256-bit base64url tokens; validate accepts them on each connection attempt', () => {
    const t = new ReconnectTokens(); const a = t.issue('dev_A'); const b = t.issue('dev_B');
    expect(a).toMatch(TOKEN_RE); expect(Buffer.from(a, 'base64url')).toHaveLength(32); expect(a).not.toBe(b);
    expect(t.validate(a, '10.0.0.1')).toEqual({ deviceId: 'dev_A' }); expect(t.validate(a, '10.0.0.1')).toEqual({ deviceId: 'dev_A' }); expect(t.validate(b, '10.0.0.2')).toEqual({ deviceId: 'dev_B' });
  });
  it('rejects one flipped bit, garbage, revoked tokens, a replaced token, and everything after the session ends', () => {
    const t = new ReconnectTokens(); const a = t.issue('dev_A');
    for (let bit = 0; bit < 256; bit += 17) expect(t.validate(flipBit(a, bit), 'ip')).toBeNull();
    for (const bad of ['', 'x', a.slice(1), a + 'A', 42 as unknown as string]) expect(t.validate(bad, 'ip')).toBeNull();
    const a2 = t.issue('dev_A'); expect(t.validate(a, 'ip')).toBeNull(); expect(t.validate(a2, 'ip')).toEqual({ deviceId: 'dev_A' });
    t.revoke('dev_A'); expect(t.validate(a2, 'ip')).toBeNull();
    const b = t.issue('dev_B'); t.endSession(); expect(t.validate(b, 'ip')).toBeNull(); expect(t.size()).toBe(0); expect(() => t.issue('dev_C')).toThrow();
  });
  it('constant-time path: every stored digest is compared, through the injected comparator, whatever the input', () => {
    let calls = 0; const t = new ReconnectTokens({ equal: (x, y) => { calls++; expect(x).toHaveLength(32); expect(y).toHaveLength(32); return Buffer.compare(x, y) === 0; } });
    const a = t.issue('dev_A'); t.issue('dev_B'); t.issue('dev_C');
    calls = 0; t.validate(a, 'ip'); expect(calls).toBe(3); // a match on the first entry does not stop the loop
    calls = 0; t.validate('short', 'ip'); expect(calls).toBe(3); // malformed input takes the same path
  });
  it('a host restart means a new ReconnectTokens: old tokens are invalid', () => { const a = new ReconnectTokens().issue('dev_A'); expect(new ReconnectTokens().validate(a, 'ip')).toBeNull(); });
  it('tokenValidator adapts to the C072 interface with the paired member', async () => {
    const s = await setup(); const r = await s.connect().p; const v = tokenValidator(s.hp.tokens, (d) => s.hp.memberFor(d));
    expect(await v.validate(r.reconnectToken, { remoteIp: '1.2.3.4' })).toEqual({ memberId: r.member.id, deviceId: GUEST_DEV, name: 'ana-desktop', role: 'editor', slot: 1 });
    expect(await v.validate(flipBit(r.reconnectToken, 3), { remoteIp: '1.2.3.4' })).toBeNull();
    expect(await tokenValidator(s.hp.tokens, () => null).validate(r.reconnectToken, { remoteIp: 'x' })).toBeNull();
  });
});

describe('guest token in the keychain', () => {
  it('is saved by guestPair under lan-token:<sid> and nowhere else', async () => {
    const s = await setup(); const before = new Set(s.guest.kc.entries.keys()); const r = await s.connect().p;
    const added = [...s.guest.kc.entries.keys()].filter((k) => !before.has(k)); expect(added).toEqual([`lan-token:${SID}`]);
    expect(await loadGuestToken(s.guest.kc, SID)).toBe(r.reconnectToken);
  });
  it('save, load (format-checked) and forget', async () => {
    const kc = memoryKeychain(); const t = new ReconnectTokens().issue('d'); await saveGuestToken(kc, SID, t); expect(await loadGuestToken(kc, SID)).toBe(t);
    await kc.set(`lan-token:${SID}`, 'tampered'); expect(await loadGuestToken(kc, SID)).toBeUndefined();
    await forgetGuestToken(kc, SID); expect(kc.entries.size).toBe(0);
  });
});
