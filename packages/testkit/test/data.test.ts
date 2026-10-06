import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MockInputError, type MockBackend } from '../src/index.js';
import { api, login, start } from './helpers.js';

let m: MockBackend | undefined; const dirs: string[] = [];
afterEach(async () => { await m?.stop(); m = undefined; dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })); });
const dir = (files: Record<string, unknown>) => { const d = mkdtempSync(join(tmpdir(), 'seed-')); dirs.push(d); for (const [f, v] of Object.entries(files)) writeFileSync(join(d, f), typeof v === 'string' ? v : JSON.stringify(v)); return d; };

const USR = 'usr_01JTEST0000000000000000001'; const WSP = 'wsp_01JTEST0000000000000000001'; const WSP2 = 'wsp_01JTEST0000000000000000002';
const SES = 'ses_01JTEST0000000000000000009'; const MEM = 'mem_01JTEST0000000000000000001';
const LIMITS = { relay_access: true, lan_multiplayer: false, max_seats: 5, max_session_members: 8, max_concurrent_sessions: 2, max_parallel_agents: 4, history_days: 30, hosted_minutes_month: 600, queue_items_month: null, audit_log_days: 30, webhooks_max: 2, api_keys_max: 2 };
const SEED = {
  'users.json': [{ id: USR, email: 'seed@example.test', display_name: 'Seeded User', locale: 'en', telemetry: false, created_at: '2026-01-01T00:00:00Z' }],
  'workspaces.json': [{ id: WSP, name: 'Alpha', slug: 'alpha', created_at: '2026-01-01T00:00:00Z' }, { id: WSP2, name: 'Beta', slug: 'beta', created_at: '2026-01-02T00:00:00Z' }],
  'sessions.json': [{ id: SES, workspace: WSP, name: 'Seeded session', state: 'live', host: MEM, policy: {}, region: 'eu', created_at: '2026-01-03T00:00:00Z' }],
  'entitlements.json': [{ workspace: WSP, plan: 'pro', status: 'active', rev: 4, limits: LIMITS }],
};

describe('--data seed loader', () => {
  it('serves users, workspaces, sessions and entitlements from the seed files, and keeps them across reset', async () => {
    m = await start({ dataDir: dir(SEED) }); const { access_token: token } = await login(m);
    const me = (await api(m, 'GET', '/v1/me', { token })).body; expect(me.user).toMatchObject({ id: USR, email: 'seed@example.test', display_name: 'Seeded User' }); expect(me.active_workspace).toBe(WSP);
    expect((await api(m, 'GET', '/v1/workspaces', { token })).body.data.map((w: { id: string }) => w.id)).toEqual([WSP, WSP2]);
    expect((await api(m, 'GET', `/v1/workspaces/${WSP2}`, { token })).body.name).toBe('Beta');
    expect((await api(m, 'GET', '/v1/workspaces/wsp_01JTEST0000000000000000003', { token })).body.code).toBe('workspace_not_found');
    expect((await api(m, 'GET', '/v1/sessions', { token })).body.data).toEqual([expect.objectContaining({ id: SES, name: 'Seeded session', state: 'live' })]);
    expect((await api(m, 'GET', `/v1/sessions/${SES}`, { token })).body).toMatchObject({ id: SES, name: 'Seeded session', region: 'eu' });
    const ent = (await api(m, 'GET', `/v1/workspaces/${WSP}/entitlements`, { token })).body; expect(ent).toMatchObject({ plan: 'pro', rev: 4, workspace: WSP }); expect(ent.limits.max_seats).toBe(5);
    m.reset(); expect(m.state.user.id).toBe(USR); expect(m.state.sessions.get(SES)?.name).toBe('Seeded session');
  });
  it('missing files are fine; an empty directory changes nothing', async () => {
    m = await start({ dataDir: dir({}) }); expect(m.state.seed).toEqual({});
  });
  it('a bad seed directory lists every violation as file#pointer and nothing starts', async () => {
    const d = dir({
      'users.json': [{ id: 'usr_bad', email: 'x' }],
      'workspaces.json': [SEED['workspaces.json'][0], SEED['workspaces.json'][0]],
      'sessions.json': { not: 'an array' },
      'entitlements.json': '{oops',
    });
    const err = await start({ dataDir: d }).then(() => undefined, (e: unknown) => e as MockInputError);
    expect(err).toBeInstanceOf(MockInputError); const where = err!.issues.map((i) => `${i.file}#${i.pointer}`);
    expect(where).toEqual(expect.arrayContaining(['users.json#/0', 'users.json#/0/id', 'workspaces.json#/1', 'sessions.json#', 'entitlements.json#']));
    expect(err!.message).toContain('users.json#/0/id');
    await expect(start({ dataDir: join(d, 'users.json') })).rejects.toThrow(/not a directory/);
  });
});
