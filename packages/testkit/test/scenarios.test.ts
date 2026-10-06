import { afterEach, describe, expect, it } from 'vitest';
import { ERROR_TABLE } from '@centcom/protocol';
import { DEFAULT_SID, SCENARIOS, type MockBackend } from '../src/index.js';
import { Peer, api, eventually, login, start } from './helpers.js';

let m: MockBackend; const peers: Peer[] = [];
afterEach(async () => { peers.splice(0).forEach((p) => p.close()); await m?.stop(); });
const open = async (o: Parameters<typeof Peer.open>[1] = {}) => { const p = await Peer.open(m, { sid: DEFAULT_SID, name: 'Me', ...o }); peers.push(p); return p; };
const joined = async (o: Parameters<typeof Peer.open>[1] = {}) => { const p = await open(o); await p.until((x) => x.has('sys.welcome') || !!x.closed); return p; };
const lastSeq = (p: Peer) => Math.max(0, ...p.seqs());

describe('bundled scenarios behave as named', () => {
  it('resume-hot: a server restart, then a reconnect replays exactly the frames missed', async () => {
    m = await start({ scenario: 'resume-hot' }); const a = await joined(); await m.advance(2000); await a.until((p) => !!p.closed);
    expect(a.closed!.code).toBe(1001); expect(a.of('sys.bye')[0].p.reason).toBe('server_restart'); const last = lastSeq(a);
    await m.advance(100); const b = await joined({ lastSeq: last }); await b.until((p) => p.has('sys.resumed'));
    const r = b.of('sys.resumed')[0].p; expect(r).toMatchObject({ from_seq: last + 1, count: 3 }); expect(b.of('event', 'message.assistant.delta')).toHaveLength(3);
  });
  it('resume-snapshot: more than 5000 frames while away means a snapshot is required', async () => {
    m = await start({ scenario: 'resume-snapshot' }); const a = await joined(); await m.advance(2000); await a.until((p) => !!p.closed); const last = lastSeq(a);
    await m.advance(100); const b = await joined({ lastSeq: last }); await b.until((p) => p.has('sys.resumed'));
    expect(b.of('sys.resumed')[0].p.snapshot_required).toBe(true); expect(b.of('sys.welcome')[0].p.resume).toEqual({ snapshot_required: true });
  });
  it('forced-disconnect: 1001, then the first reconnect is closed 4429 and the next 4400', async () => {
    m = await start({ scenario: 'forced-disconnect' }); const a = await joined(); await m.advance(3000); await a.until((p) => !!p.closed); expect(a.closed!.code).toBe(1001);
    const b = await open(); await b.until((p) => !!p.closed); expect(b.closed!.code).toBe(4429); expect(b.of('sys.error').at(-1).p).toMatchObject({ code: 'rate_limited', retry_after_s: 2 });
    const c = await open(); await c.until((p) => !!p.closed); expect(c.closed!.code).toBe(4400);
  });
  it('ticket-expired: 4401 after sys.error ticket_invalid, and the next API call says token_expired', async () => {
    m = await start({ scenario: 'ticket-expired' }); const t = await login(m); const a = await joined(); await m.advance(2000); await a.until((p) => !!p.closed);
    expect(a.closed!.code).toBe(4401); expect(a.of('sys.error').at(-1).p.code).toBe('ticket_invalid');
    expect((await api(m, 'POST', `/v1/sessions/${DEFAULT_SID}/join-token`, { token: t.access_token, body: {} })).body.code).toBe('token_expired');
  });
  it('superseded: sys.bye superseded then 4409', async () => {
    m = await start({ scenario: 'superseded' }); const a = await joined(); await m.advance(2000); await a.until((p) => !!p.closed);
    expect(a.closed!.code).toBe(4409); expect(a.of('sys.bye')[0].p.reason).toBe('superseded');
  });
  it('kicked: the member is removed (member_left, rotate_key on consecutive seqs), told kicked, closed 4403', async () => {
    m = await start({ scenario: 'kicked' }); const a = await joined(); await m.advance(2000); await a.until((p) => !!p.closed);
    expect(a.closed!.code).toBe(4403); expect(a.of('sys.bye')[0].p.reason).toBe('kicked');
    const log = m.frames(DEFAULT_SID).slice(-2); expect(log.map((f) => f.k)).toEqual(['control.member_left', 'control.rotate_key']); expect(log[1]!.seq).toBe(log[0]!.seq! + 1);
  });
  it('host-loss: the virtual host goes away, the session pauses after the 10 minute grace, and goes live when the host is back', async () => {
    m = await start({ scenario: 'host-loss' }); const a = await joined(); expect(a.of('sys.welcome')[0].p.member.role).toBe('editor');
    a.send({ v: 1, t: 'sys.pong', p: {} });
    const states = () => a.of('control', 'control.session_state').map((f) => f.p.state);
    for (let t = 0; t < 600_000; t += 20_000) await m.advance(20_000); /* answer pings so the client stays alive */
    await m.advance(5000); await a.until(() => states().includes('paused')); expect(a.closed).toBeUndefined();
    for (let t = 0; t < 300_000; t += 20_000) await m.advance(20_000); await a.until(() => states().at(-1) === 'live');
  });
  it('slow-consumer: a client that stops reading gets sys.slow_down and then 4429', { timeout: 30_000 }, async () => {
    m = await start({ scenario: 'slow-consumer' }); const a = await open({ paused: true }); await eventually(() => m.relay.connections().length === 1);
    const sock = (a.ws as unknown as { _socket: { pause(): void; resume(): void } })._socket;
    await m.advance(1000); sock.resume(); await a.until((p) => !!p.closed, 10_000);
    expect(a.has('sys.slow_down')).toBe(true); expect(a.closed!.code).toBe(4429);
  });
  it('bad-frames: three sys.error invalid_frame, an unknown kind delivered, then 4400', async () => {
    m = await start({ scenario: 'bad-frames' }); const a = await joined(); await m.advance(3000); await a.until((p) => !!p.closed);
    expect(a.of('sys.error').filter((f) => f.p.code === 'invalid_frame')).toHaveLength(3); expect(a.has('event', 'future.kind')).toBe(true); expect(a.closed!.code).toBe(4400);
  });
  it('quota-warning: usage notices, rising entitlement warnings, quota_reached, then quota_exceeded on the API', async () => {
    m = await start({ scenario: 'quota-warning' }); const t = await login(m); const a = await joined(); const wsp = m.state.workspace;
    await m.advance(1000); await a.until((p) => p.has('sys.notice')); expect(a.of('sys.notice')[0].p).toMatchObject({ code: 'usage_warning', level: 'warn', params: { pct: 80 } });
    expect((await api(m, 'GET', `/v1/workspaces/${wsp}/entitlements`, { token: t.access_token })).body.warnings).toEqual([{ limit: 'hosted_minutes_month', pct: 80 }]);
    await m.advance(4000); await a.until((p) => p.of('sys.notice').length === 3); expect(a.of('sys.notice').map((f) => f.p.code)).toEqual(['usage_warning', 'usage_warning', 'quota_reached']);
    expect((await api(m, 'GET', '/v1/me', { token: t.access_token })).body.code).toBe('quota_exceeded');
    const ent = (await api(m, 'GET', `/v1/workspaces/${wsp}/entitlements`, { token: t.access_token })).body; expect(ent.warnings[0].pct).toBe(100); expect(ent.rev).toBeGreaterThanOrEqual(3);
  });
  it('maintenance: a warning on join, then 503 everywhere but status, open sockets closed 4503 and new ones refused', async () => {
    m = await start({ scenario: 'maintenance' }); const t = await login(m); const a = await joined(); await a.until((p) => p.has('sys.notice'));
    expect(a.of('sys.notice')[0].p.code).toBe('maintenance_soon');
    await m.advance(5000); await a.until((p) => !!p.closed); expect(a.closed!.code).toBe(4503);
    const r = await api(m, 'GET', '/v1/me', { token: t.access_token }); expect(r.status).toBe(503); expect(r.headers.get('retry-after')).toBe('30');
    expect((await api(m, 'GET', '/healthz')).status).toBe(200);
    const b = await open(); await b.until((p) => !!p.closed); expect(b.closed!.code).toBe(4503);
  });
  it('client-too-old: the API answers client_too_old and the relay closes 4426', async () => {
    m = await start({ scenario: 'client-too-old' }); const t = await login(m);
    expect((await api(m, 'GET', '/v1/me', { token: t.access_token, headers: { 'user-agent': 'centcom-cli/1.0.0' } })).body.code).toBe('client_too_old');
    const a = await open(); await a.until((p) => !!p.closed); expect(a.closed!.code).toBe(4426);
  });
  it('overload-4503: sockets closed 4503 with retry_after_s, and the next two API calls are 503', async () => {
    m = await start({ scenario: 'overload-4503' }); const t = await login(m); const a = await joined(); await m.advance(2000); await a.until((p) => !!p.closed);
    expect(a.closed!.code).toBe(4503); expect(a.of('sys.error').at(-1).p.retry_after_s).toBe(5);
    const codes = []; for (let i = 0; i < 3; i++) codes.push((await api(m, 'GET', '/v1/me', { token: t.access_token })).status); expect(codes).toEqual([503, 503, 200]);
  });
  it('errors: the next calls answer every registry code once, each with its contract status', async () => {
    m = await start({ scenario: 'errors' }); const order = SCENARIOS.errors!.steps.map((s) => String(s.args.code));
    for (const code of order) { const r = await api(m, 'GET', '/healthz'); expect(r.body.code, code).toBe(code); expect(r.status, code).toBe(ERROR_TABLE[code as keyof typeof ERROR_TABLE].status); }
    expect((await api(m, 'GET', '/healthz')).status).toBe(200);
  });
  it('rate-limited: three calls pass, then 429 with Retry-After 7', async () => {
    m = await start({ scenario: 'rate-limited' }); const s = []; for (let i = 0; i < 4; i++) s.push(await api(m, 'GET', '/healthz'));
    expect(s.map((r) => r.status)).toEqual([200, 200, 200, 429]); expect(s[3]!.headers.get('retry-after')).toBe('7');
  });
  it('busy-session: a host and two editors are already in the roster; setScenario replaces pending steps', async () => {
    m = await start({ scenario: 'busy-session' }); const roster = [...m.state.sessions.get(DEFAULT_SID)!.members.values()];
    expect(roster.map((x) => [x.name, x.role])).toEqual([['Host', 'host'], ['Ada', 'editor'], ['Bo', 'editor']]);
    m.setScenario('resume-hot'); m.setScenario('rate-limited'); const a = await joined(); await m.advance(3000); await eventually(() => true); expect(a.closed).toBeUndefined(); /* resume-hot's 1001 was cancelled */
  });
});
