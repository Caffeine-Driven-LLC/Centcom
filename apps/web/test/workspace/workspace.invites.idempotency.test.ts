import { describe, expect, it } from 'vitest';
import { InviteDialog, ulid } from '../../src/workspace/data.js';
import { HttpErr, fakeHttp } from './helpers.js';

describe('invites (acceptance 4)', () => {
  it('a double click sends one request with one Idempotency-Key and gives one invite', async () => {
    const http = fakeHttp(async () => { await new Promise((r) => setTimeout(r, 10)); return { data: { id: 'inv_1' }, replayed: false, status: 201 }; }); const d = new InviteDialog(http, 'w'); const [a, b] = await Promise.all([d.create({ email: 'a@b.c', role: 'member' }), d.create({ email: 'a@b.c', role: 'member' })]); expect(a).toEqual(b); expect(http.calls.filter((c) => c.op === 'createInvite')).toHaveLength(1); expect(http.calls[0]!.o!.idempotencyKey).toBe(d.key); expect(d.key).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/); expect(await d.create({ email: 'a@b.c', role: 'member' })).toMatchObject({ ok: true }); expect(d.requests).toBe(1);
  });
  it('a retry after a failure uses the same key, and a replayed answer is a success', async () => {
    let n = 0; const http = fakeHttp(() => { if (n++ === 0) throw new HttpErr('internal_error', 500); return { data: { id: 'inv_1' }, replayed: true, status: 201 }; }); const d = new InviteDialog(http, 'w'); expect(await d.create({ role: 'guest' })).toMatchObject({ ok: false, reason: 'error' }); expect(await d.create({ role: 'guest' })).toEqual({ ok: true, invite: { id: 'inv_1' }, replayed: true }); expect(new Set(http.calls.map((c) => c.o!.idempotencyKey)).size).toBe(1);
  });
  it('a new dialog gets a new key; the seat limit and the rate limit are reported without a retry loop', async () => {
    expect(new InviteDialog(fakeHttp(() => ({})), 'w').key).not.toBe(new InviteDialog(fakeHttp(() => ({})), 'w').key);
    expect(await new InviteDialog(fakeHttp(() => { throw new HttpErr('seat_limit_reached', 402); }), 'w').create({ role: 'member' })).toEqual({ ok: false, reason: 'no_seats' }); expect(await new InviteDialog(fakeHttp(() => { throw new HttpErr('rate_limited', 429, 12); }), 'w').create({ role: 'member' })).toEqual({ ok: false, reason: 'rate_limited', retryAfterS: 12 });
  });
  it('ulids are 26 characters, sortable by time', () => { const a = ulid(1_000_000, () => new Uint8Array(16)); const b = ulid(2_000_000, () => new Uint8Array(16)); expect(a).toHaveLength(26); expect(a < b).toBe(true); });
});
