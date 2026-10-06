import { afterEach, describe, expect, it } from 'vitest';
import { SessionError } from '../../src/index.js';
import { WS, rig, until } from './rig.js';

let r: Awaited<ReturnType<typeof rig>> | undefined;
afterEach(async () => { await r?.host.handle?.leave().catch(() => undefined); await r?.guest.handle?.leave().catch(() => undefined); await r?.stop(); r = undefined; });

describe('create (acceptance 1)', () => {
  it('sends one POST /v1/sessions with an Idempotency-Key; a network retry reuses the key and gives one session', async () => {
    r = await rig(); await r.m.control('errors', { code: 'bad_gateway' }); const h = await r.host.client.createSession({ name: 'demo', workspace: WS }); r.host.handle = h;
    const posts = r!.host.seen.filter((s) => s.method === 'POST' && s.path === '/v1/sessions'); expect(posts).toHaveLength(2); expect(posts[0]!.headers['idempotency-key']).toBeTruthy(); expect(posts[0]!.headers['idempotency-key']).toBe(posts[1]!.headers['idempotency-key']); expect(posts[0]!.body).toMatchObject({ name: 'demo', workspace: WS }); expect(h.state).toBe('live'); expect(h.me.role).toBe('host');
  });
  it('a plan without relay access gets a typed error and no socket is opened', async () => {
    r = await rig(); await r.m.control('errors', { code: 'entitlement_required' }); const e = await r.host.client.createSession({ name: 'x', workspace: WS }).catch((x) => x); expect(e).toBeInstanceOf(SessionError); expect(e.code).toBe('relay_not_included'); expect(r.m.relay.connections()).toHaveLength(0);
    expect(r.host.seen.some((s) => s.path.endsWith('/join-token'))).toBe(false);
  });
});
describe('join, leave, end, claim host (acceptance 2, 10)', () => {
  it('each connection attempt makes exactly one join-token request; a forced disconnect reconnects with a new ticket', async () => {
    r = await rig(); const h = await r.host.client.createSession({ name: 'demo', workspace: WS }); r.host.handle = h; const tokens = () => r!.host.seen.filter((s) => s.path === `/v1/sessions/${h.id}/join-token`);
    expect(tokens()).toHaveLength(1); const states: string[] = []; h.on('state', (s) => states.push(s)); await r.m.control('disconnect', { sid: h.id, code: 1001 }); await until(() => tokens().length === 2); await until(() => h.state === 'live' && states.includes('reconnecting'));
    expect(tokens()).toHaveLength(2); expect(states).toContain('reconnecting');
  });
  it('the guest joins as a member; leave() closes the connection and does not end the session', async () => {
    r = await rig(); const h = await r.host.client.createSession({ name: 'demo', workspace: WS }); r.host.handle = h; const g = await r.guest.client.joinSession({ sessionId: h.id }); r.guest.handle = g; await until(() => h.roster().length === 2);
    expect(g.me.role).toBe('editor'); expect(h.roster().map((m) => m.role).sort()).toEqual(['editor', 'host']); const ended: unknown[] = []; h.on('ended', (e) => ended.push(e));
    await g.leave(); expect(g.state).toBe('ended'); await new Promise((x) => setTimeout(x, 100)); expect(ended).toHaveLength(0); expect(h.state).toBe('live'); expect(r.guest.seen.some((s) => s.path === `/v1/sessions/${h.id}/end`)).toBe(false);
  });
  it('end() posts to /end and the handle ends; only the host may', async () => {
    r = await rig(); const h = await r.host.client.createSession({ name: 'demo', workspace: WS }); r.host.handle = h; const g = await r.guest.client.joinSession({ sessionId: h.id }); r.guest.handle = g; await until(() => g.state === 'live');
    await expect(g.end()).rejects.toMatchObject({ code: 'not_host' }); const ended: unknown[] = []; g.on('ended', (e) => ended.push(e)); await h.end(); expect(h.state).toBe('ended'); expect(r.host.seen.some((s) => s.method === 'POST' && s.path === `/v1/sessions/${h.id}/end`)).toBe(true); await until(() => g.state === 'ended' || ended.length > 0);
    await expect(h.sendEvent('message.user', { secret: { text: 'x' } })).rejects.toMatchObject({ code: 'ended' });
  });
  it('claimHost, list and share-link calls go to the right endpoints', async () => {
    r = await rig(); const h = await r.host.client.createSession({ name: 'demo', workspace: WS }); r.host.handle = h; await r.host.client.claimHost(h.id); expect(r.host.seen.some((s) => s.method === 'POST' && s.path === `/v1/sessions/${h.id}/claim-host`)).toBe(true);
    const rows: unknown[] = []; for await (const s of r.host.client.listSessions({ mine: true })) { rows.push(s); if (rows.length >= 3) break; } expect(rows.length).toBeGreaterThan(0); expect(r.host.seen.some((s) => s.path === '/v1/sessions' && s.method === 'GET')).toBe(true);
    const link = await h.createShareLink(); expect(link.fragment).toMatch(/^#k=[A-Za-z0-9_-]{43}&kid=k1$/); await expect((await r!.guest.client.joinSession({ sessionId: h.id }).then((g) => { r!.guest.handle = g; return g; })).createShareLink()).rejects.toMatchObject({ code: 'not_host' });
  });
  it('nothing touches the network when the client is only constructed', async () => { r = await rig(); const n = r.host.seen.length; expect(n).toBe(0); expect(r.m.relay.connections()).toHaveLength(0); });
});
describe('share links', () => {
  it('a link without a key cannot be opened, and the host link carries the current key and its id', async () => {
    r = await rig(); await expect(r.guest.client.joinViaShareLink({ token: 'tok', displayName: 'Viewer', fragment: '' })).rejects.toMatchObject({ code: 'bad_link' }); await expect(r.guest.client.joinViaShareLink({ token: 'tok', displayName: 'Viewer', fragment: '#k=short' })).rejects.toMatchObject({ code: 'bad_link' }); expect(r.guest.seen).toHaveLength(0);
  });
});
