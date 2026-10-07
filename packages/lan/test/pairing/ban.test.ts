import { describe, expect, it } from 'vitest';
import { VirtualClock } from '@centcom/testkit';
import { BAN_MS, MemoryBanList } from '../../src/index.js';
import { setup, wrongCode } from './helpers.js';

const flush = () => new Promise((r) => setImmediate(r));

describe('5 attempts per code and the 10-minute IP ban (acceptance 4)', () => {
  it('after 5 wrong codes the 6th attempt with the CORRECT code is rejected and the IP is banned for 10 minutes', async () => {
    const s = await setup(); const ip = '192.168.1.50';
    for (let i = 0; i < 5; i++) await expect(s.connect({ code: wrongCode(s.display), ip }).p).rejects.toMatchObject({ pairReason: 'bad_code' });
    await flush();
    expect(s.failed.filter((f) => f.reason === 'bad_code')).toHaveLength(5); expect(s.bans.isBanned(ip)).toBe(true);
    // from the banned IP: refused at once with locked_out
    await expect(s.connect({ ip }).p).rejects.toMatchObject({ pairReason: 'locked_out' });
    // from another IP: the code itself is used up, so even the right code fails
    await expect(s.connect({ ip: '192.168.1.51' }).p).rejects.toMatchObject({ pairReason: 'locked_out' }); await flush();
    expect(s.failed.at(-1)).toEqual({ ip: '192.168.1.51', reason: 'too_many' }); expect(s.paired).toEqual([]);
    await s.clock.advance(BAN_MS); expect(s.bans.isBanned(ip)).toBe(true);
    await s.clock.advance(1000); expect(s.bans.isBanned(ip)).toBe(false);
    const fresh = s.hp.openCode(); await expect(s.connect({ ip, code: fresh.display }).p).resolves.toBeTruthy();
  });
  it('a reconnecting attacker does not reset the counter: attempts live on the host, not on the socket', async () => {
    const s = await setup();
    for (let i = 0; i < 5; i++) await expect(s.connect({ code: wrongCode(s.display), ip: `10.9.0.${i}` }).p).rejects.toBeTruthy();
    await expect(s.connect({ ip: '10.9.0.99' }).p).rejects.toMatchObject({ pairReason: 'locked_out' });
  });
});

describe('MemoryBanList', () => {
  it('bans after the threshold inside the window; old failures fall out; IPv4-mapped addresses are one address', async () => {
    const clock = new VirtualClock(); const b = new MemoryBanList(clock);
    for (let i = 0; i < 4; i++) expect(b.recordFailure('::ffff:10.0.0.1')).toBe(false);
    expect(b.recordFailure('10.0.0.1')).toBe(true); expect(b.isBanned('::FFFF:10.0.0.1')).toBe(true);
    b.unban('10.0.0.1'); expect(b.isBanned('10.0.0.1')).toBe(false);
    for (let i = 0; i < 4; i++) b.recordFailure('10.0.0.2'); await clock.advance(10 * 60_000); expect(b.recordFailure('10.0.0.2')).toBe(false);
    b.ban('10.0.0.3', 1000); expect(b.isBanned('10.0.0.3')).toBe(true); await clock.advance(1001); expect(b.isBanned('10.0.0.3')).toBe(false);
  });
  it('stays bounded under a flood of distinct addresses', () => {
    const clock = new VirtualClock(); const b = new MemoryBanList(clock, { threshold: 2 });
    for (let i = 0; i < 20_000; i++) b.recordFailure(`10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}`);
    const inner = b as unknown as { failures: Map<string, unknown>; bans: Map<string, unknown> }; expect(inner.failures.size).toBeLessThanOrEqual(4096); expect(inner.bans.size).toBeLessThanOrEqual(4096);
  });
});
