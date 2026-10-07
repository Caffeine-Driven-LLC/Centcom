import { describe, expect, it } from 'vitest';
import { FingerprintMismatchError, LAN_MESSAGES, PairingError } from '../../src/index.js';
import { deviceKeys, setup, wrongCode } from './helpers.js';

describe('secrets never in logs, errors or the trust store (acceptance 10)', () => {
  it('a session with a pairing, a wrong code and a fingerprint mismatch leaks nothing', async () => {
    const s = await setup(); const errors: unknown[] = [];
    const ok = await s.connect().p;
    const secrets = [s.display, s.display.replace('-', ''), ok.reconnectToken, JSON.parse(s.guestSent[1]!).confirm, JSON.parse(s.hostSent[1]!).confirm, s.host.d.fingerprint(), s.guest.d.fingerprint()];
    const code2 = s.hp.openCode().display; secrets.push(code2);
    await s.connect({ code: wrongCode(code2), ip: '10.0.0.2' }).p.catch((e: unknown) => errors.push(e));
    const other = await deviceKeys('dev_01JA3Z8K2M5N7P9Q0R1S2T3V4O');
    await s.connect({ expectedFingerprint: other.d.fingerprint(), ip: '10.0.0.3' }).p.catch((e: unknown) => errors.push(e));
    expect(errors[0]).toBeInstanceOf(PairingError); expect(errors[1]).toBeInstanceOf(FingerprintMismatchError);
    const haystack = [...s.logs, ...errors.map((e) => `${String(e)} ${JSON.stringify(e)} ${(e as Error).stack ?? ''}`), JSON.stringify(s.failed)].join('\n');
    const stored = JSON.stringify(s.trust.list()); for (const secret of secrets.slice(0, 5).concat(code2)) expect(stored).not.toContain(secret);
    expect(Object.keys(s.trust.list()[0]!).sort()).toEqual(['ed25519', 'fingerprint', 'id', 'name', 'x25519']);
    expect(s.logs.map((l) => JSON.parse(l).msg)).toEqual(expect.arrayContaining(['lan.pair.paired', 'lan.pair.failed']));
    for (const secret of [...secrets, other.d.fingerprint()]) expect(haystack, 'a secret leaked').not.toContain(secret);
    expect(JSON.stringify(s.trust.list())).not.toMatch(/token|code|isk/i);
  });
  it('every user-facing message is static text', () => {
    for (const m of Object.values(LAN_MESSAGES)) { expect(m).not.toMatch(/\$\{/); expect(m.length).toBeLessThan(220); }
    expect(new PairingError('bad_code').message).toBe(LAN_MESSAGES.bad_code);
  });
});
