import { describe, expect, it } from 'vitest';
import { Team, teamWhy } from '../../src/collab/team.js';

/** A fake REST client that answers by operation and records what was asked. */
function fake(answers: Record<string, unknown | (() => unknown)>) {
  const calls: { op: string; args: { path?: Record<string, string>; body?: Record<string, unknown>; headers?: Record<string, string> } }[] = [];
  const http = { call: async (op: string, args: never) => { calls.push({ op, args }); const a = answers[op]; if (a === undefined) throw Object.assign(new Error('no ' + op), { code: 'not_found' }); const v = typeof a === 'function' ? (a as () => unknown)() : a; if (v instanceof Error) throw v; return { data: v }; } };
  return { http: http as never, calls };
}
const ME = { id: 'usr_me', workspace: { id: 'wsp_1' } };
const members = { data: [{ id: 'mem_1', user: 'usr_me', display_name: 'Alice', email: 'a@x.test', role: 'owner' }, { id: 'mem_2', user: 'usr_b', display_name: 'Bob', role: 'member' }] };
const base = { getWorkspace: { name: 'Acme' }, listMembers: members, getEntitlements: { plan: 'pro', status: 'active', limits: { relay_access: true, max_seats: 3 } }, getSubscription: { seats: 3 } };

describe('the team of a workspace', () => {
  it('shows members, open invites (not session invites), the plan, seats and whether the relay is included', async () => {
    const f = fake({ ...base, listInvites: { data: [{ id: 'inv_1', email: 'c@x.test', role: 'guest', status: 'pending', expires_at: '2026-10-20T00:00:00Z' }, { id: 'inv_2', email: 'd@x.test', role: 'editor', status: 'pending', session: 'ses_1', expires_at: 'x' }, { id: 'inv_3', email: 'e@x.test', role: 'member', status: 'revoked', expires_at: 'x' }] } });
    const v = await new Team({ http: f.http, baseUrl: 'http://x', me: ME }).load();
    expect(v).toMatchObject({ workspace: { id: 'wsp_1', name: 'Acme' }, plan: 'pro', seats: { used: 2, max: 3 }, relayAccess: true, myRole: 'owner', canManage: true });
    expect(v.members.map((m) => [m.name, m.role, m.you])).toEqual([['Alice', 'owner', true], ['Bob', 'member', false]]); expect(v.invites).toEqual([{ id: 'inv_1', email: 'c@x.test', role: 'guest', expiresAt: '2026-10-20T00:00:00Z' }]);
  });
  it('a plain member may look but not manage, and a missing invite list is not fatal', async () => {
    const f = fake({ ...base, listMembers: { data: [{ id: 'mem_2', user: 'usr_me', display_name: 'Bob', role: 'member' }] } }); const v = await new Team({ http: f.http, baseUrl: 'http://x', me: ME }).load();
    expect(v.canManage).toBe(false); expect(v.invites).toEqual([]);
  });
  it('a free plan has no relay, and the upgrade goes to the hosted checkout when the server gives one, else to the billing page', async () => {
    const free = { ...base, getEntitlements: { plan: 'free', status: 'active', limits: { relay_access: false, max_seats: 1 } }, listInvites: { data: [] } };
    expect((await new Team({ http: fake(free).http, baseUrl: 'http://x', me: ME }).load()).relayAccess).toBe(false);
    expect(await new Team({ http: fake({ ...free, createCheckout: { url: 'https://pay.example/checkout/1' } }).http, baseUrl: 'http://x', me: ME }).upgradeUrl()).toBe('https://pay.example/checkout/1');
    expect(await new Team({ http: fake(free).http, baseUrl: 'http://x', me: ME }).upgradeUrl()).toBe('https://centcom.dev/billing');
    expect(await new Team({ http: fake({ ...free, createCheckout: { url: 'http://insecure.example' } }).http, baseUrl: 'http://x', me: ME, billingUrl: 'https://b.example/billing' }).upgradeUrl()).toBe('https://b.example/billing');
  });
  it('invites with a role and an idempotency key, revokes, changes a role, removes', async () => {
    const f = fake({ ...base, createInvite: { id: 'inv_9', token: 'TOK' }, revokeInvite: {}, updateMember: {}, removeMember: {} }); const t = new Team({ http: f.http, baseUrl: 'http://x', me: ME });
    expect(await t.invite(' c@x.test ', 'admin')).toEqual({ url: 'https://centcom.dev/i/TOK', email: 'c@x.test' }); await t.revoke('inv_9'); await t.setRole('mem_2', 'billing'); await t.remove('mem_2');
    const by = (op: string) => f.calls.find((c) => c.op === op)!.args;
    expect(by('createInvite')).toMatchObject({ path: { id: 'wsp_1' }, body: { email: 'c@x.test', role: 'admin' } }); expect(by('createInvite').headers?.['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/);
    expect(by('revokeInvite')).toMatchObject({ path: { id: 'wsp_1', invite: 'inv_9' } }); expect(by('updateMember')).toMatchObject({ path: { mem: 'mem_2' }, body: { role: 'billing' } }); expect(by('removeMember')).toMatchObject({ path: { mem: 'mem_2' } });
  });
  it('refuses a bad address or role before asking the server, and never offers owner as a role', async () => {
    const f = fake(base); const t = new Team({ http: f.http, baseUrl: 'http://x', me: ME });
    await expect(t.invite('not an address', 'member')).rejects.toMatchObject({ code: 'validation_failed' }); await expect(t.invite('a@x.test', 'owner' as never)).rejects.toMatchObject({ code: 'validation_failed' }); await expect(t.setRole('mem_2', 'owner' as never)).rejects.toMatchObject({ code: 'validation_failed' });
    expect(f.calls).toEqual([]);
  });
  it('says what went wrong in words', () => {
    for (const [code, re] of [['seat_limit_reached', /no seat left/], ['member_exists', /already in/], ['forbidden', /owner or admin/], ['validation_failed', /e-mail/]] as const) expect(teamWhy(Object.assign(new Error('x'), { code }))).toMatch(re);
    expect(teamWhy(new Error('fetch failed'))).toMatch(/reach/);
  });
  it('without a workspace there is nothing to load', async () => { await expect(new Team({ http: fake(base).http, baseUrl: 'http://x', me: { id: 'u' } }).load()).rejects.toMatchObject({ code: 'workspace_not_found' }); });
});
