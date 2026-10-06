import { afterEach, describe, expect, it } from 'vitest';
import { MSG } from '../../src/commands/account/messages.js';
import { accountEnv, json, type Env } from './helpers.js';

let env: Env | undefined; afterEach(async () => { await env?.stop(); env = undefined; });
const USER = { id: 'usr_01JA3Z8K2M5N7P9Q0R1S2T3V4W', email: 'p@example.test', display_name: 'Pat', locale: 'en', telemetry: false, created_at: '2026-10-06T12:00:00.000Z' };
const meWith = (plan: string, ws: string | null = null, ent = 7) => (r: { path: string }) => (r.path === '/v1/me' ? json(200, { user: USER, plan, active_workspace: ws, ent }) : undefined);

/** The --json shape from the C053 card, checked field by field. */
function checkShape(j: unknown): void {
  const o = j as Record<string, unknown>; expect(Object.keys(o).sort()).toEqual(['entitlement_rev', 'plan', 'user', 'workspace']);
  const u = o.user as Record<string, unknown>; expect(Object.keys(u).sort()).toEqual(['display_name', 'email', 'id']); for (const k of ['id', 'display_name', 'email']) expect(typeof u[k]).toBe('string');
  expect(typeof o.plan).toBe('string'); expect(Number.isInteger(o.entitlement_rev)).toBe(true);
  if (o.workspace !== null) { const w = o.workspace as Record<string, unknown>; expect(Object.keys(w).sort()).toEqual(['id', 'name']); expect(typeof w.id).toBe('string'); expect(w.name === null || typeof w.name === 'string').toBe(true); }
}

describe('centcom whoami (acceptance 4)', () => {
  it('not signed in: exit 2 with a centcom login hint and no network call', async () => {
    env = await accountEnv();
    expect(await env.run('whoami')).toBe(2); expect(env.err).toEqual([MSG.errors.notSignedIn]); expect(env.err[0]).toContain('centcom login'); expect(env.seen).toHaveLength(0);
    expect(await env.run('whoami', '--json')).toBe(2); expect(env.out).toHaveLength(0); expect(env.seen).toHaveLength(0);
  });
  for (const plan of ['free', 'pro', 'team']) {
    it(`signed in on ${plan}: prints the plan from GET /v1/me`, async () => {
      env = await accountEnv({ override: meWith(plan) }); await env.signIn();
      expect(await env.run('whoami')).toBe(0);
      expect(env.out).toEqual([`Pat <p@example.test> (${USER.id})`, `Plan: ${plan[0]!.toUpperCase()}${plan.slice(1)}`, 'Workspace: none', 'Entitlement revision: 7']);
      expect(env.seen.map((r) => r.path)).toEqual(['/v1/me']);
    });
  }
  it('--json validates against the card shape, with the active workspace and its name', async () => {
    env = await accountEnv(); await env.signIn();
    expect(await env.run('whoami', '--json')).toBe(0); expect(env.out).toHaveLength(1);
    const j = JSON.parse(env.out[0]!); checkShape(j);
    expect(j.user).toEqual({ id: env.m.state.user.id, display_name: 'Dev Tester', email: 'dev@example.test' }); expect(j.workspace.id).toBe(env.m.state.workspace); expect(['free', 'pro', 'team']).toContain(j.plan);
  });
  it('--json with no workspace and an unknown plan value (tolerated)', async () => {
    env = await accountEnv({ override: meWith('enterprise', null, 0) }); await env.signIn();
    expect(await env.run('whoami', '--json')).toBe(0); const j = JSON.parse(env.out[0]!); checkShape(j); expect(j).toMatchObject({ plan: 'enterprise', workspace: null, entitlement_rev: 0 });
  });
  it('a workspace whose name cannot be loaded is shown with name null', async () => {
    env = await accountEnv({ override: (r) => (r.path.startsWith('/v1/workspaces/') ? json(404, { type: 'x', title: 'x', status: 404, code: 'workspace_not_found' }) : meWith('pro', 'wsp_01JA3Z8K2M5N7P9Q0R1S2T3V4W')(r)) }); await env.signIn();
    expect(await env.run('whoami', '--json')).toBe(0); expect(JSON.parse(env.out[0]!).workspace).toEqual({ id: 'wsp_01JA3Z8K2M5N7P9Q0R1S2T3V4W', name: null });
    env.out.length = 0; expect(await env.run('whoami')).toBe(0); expect(env.out[2]).toBe('Workspace: unnamed (wsp_01JA3Z8K2M5N7P9Q0R1S2T3V4W)');
  });
  it('401 device_revoked: local tokens cleared, exit 2 with a re-login hint', async () => {
    env = await accountEnv(); const { deviceId } = await env.signIn(); await env.m.control('revoke-device', { device: deviceId });
    expect(await env.run('whoami')).toBe(2); expect(env.err.join(' ')).toMatch(/removed from your account.*centcom login/);
    expect(env.kc.entries.size).toBe(0); expect(await env.tm.status()).toMatchObject({ signedIn: false });
  });
  it('a sign-in the server ended at refresh time is exit 2', async () => {
    env = await accountEnv(); await env.signIn(); await env.m.advance(16 * 60_000); await env.m.control('errors', { code: 'refresh_reuse_detected' });
    expect(await env.run('whoami')).toBe(2); expect(env.err).toEqual([MSG.errors.sessionEnded]);
  });
  it('server unreachable: exit 1 with the offline line, no request id, no stack trace', async () => {
    env = await accountEnv(); await env.signIn(); env.ctl.offline = true;
    expect(await env.run('whoami')).toBe(1); expect(env.err).toEqual([MSG.errors.offline]); expect(env.err.join('\n')).not.toMatch(/req_|\bat \S+:\d+/);
  });
  it('a server error shows the message table text and the reference', async () => {
    env = await accountEnv(); await env.signIn(); await env.m.control('errors', { code: 'forbidden' });
    expect(await env.run('whoami')).toBe(1); expect(env.err[0]).toMatch(/^You do not have permission to do that\. .*Ref: req_/);
  });
  it('bad flags: usage, exit 1', async () => {
    env = await accountEnv(); expect(await env.run('whoami', '--nope')).toBe(1); expect(env.err).toContain(MSG.usage.whoami);
  });
});
