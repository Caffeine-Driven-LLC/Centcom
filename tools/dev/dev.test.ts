import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { describe, expect, it } from 'vitest';
import { SECRET_PATTERNS } from '@centcom/protocol';
import { defaultDeps, loadConfig } from '@centcom/config';
import { startMockBackend } from '@centcom/testkit';
// @ts-expect-error plain JS tool
import { makeFixtureRepo } from './make-fixture-repo.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url)); const SEED = join(ROOT, 'dev/seed');
const read = (f: string) => JSON.parse(readFileSync(join(SEED, f), 'utf8')) as Record<string, unknown>[];
const tmp = () => mkdtempSync(join(tmpdir(), 'cc-dev-'));
const ULID = /^[a-z]{3}_[0-9A-HJKMNP-TV-Z]{26}$/;

describe('seed data', () => {
  it('the mock accepts it (it checks every item against the OpenAPI schemas) and serves it', async () => {
    const m = await startMockBackend({ clock: 'virtual', seed: 7, dataDir: SEED });
    try { expect((await fetch(m.url + '/v1/status')).status).toBe(200); const tok = m.mintToken({ expSeconds: 3600 }); const ws = await (await fetch(m.url + '/v1/workspaces', { headers: { authorization: `Bearer ${tok}` } })).json() as { data: { name: string; plan: string }[] }; expect(ws.data.map((w) => w.name).sort()).toEqual(['Acme Pro', 'Acme Team', 'Ada Personal']); } finally { await m.stop(); }
  });
  it('every id is a prefixed ULID and ids are unique across all files', () => {
    const ids: string[] = []; const walk = (v: unknown, key = ''): void => { if (typeof v === 'string' && (key === 'id' || key === 'owner' || key === 'host' || key === 'workspace' || key === 'session')) { expect(v, key).toMatch(ULID); if (key === 'id') ids.push(v); } else if (Array.isArray(v)) v.forEach((x) => walk(x)); else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, k); };
    for (const f of readdirSync(SEED)) walk(read(f)); expect(new Set(ids).size).toBe(ids.length); expect(read('users.json').map((u) => u.display_name)).toEqual(['Ada Lovelace', 'Ben Okafor', 'Cy Tanaka', 'Dee Marsh']);
  });
  it('free, pro and team differ in relay access (false, true, true) and parallel agents', () => {
    const e = Object.fromEntries(read('entitlements.json').map((x) => [x.plan as string, x.limits as Record<string, unknown>])); expect([e.free!.relay_access, e.pro!.relay_access, e.team!.relay_access]).toEqual([false, true, true]); expect(new Set([e.free!.max_parallel_agents, e.pro!.max_parallel_agents, e.team!.max_parallel_agents]).size).toBe(3);
  });
  it('the notifications cover every category of the contract, with message keys and no display text', () => {
    const schema = JSON.parse(readFileSync(join(ROOT, 'contracts/schemas/notification.schema.json'), 'utf8')); const req = createRequire(join(ROOT, 'packages/testkit/package.json')); const Ajv = req('ajv/dist/2020.js').default; const v = new Ajv({ strict: false, validateFormats: false, allErrors: true }).compile(schema); const n = read('notifications.json');
    expect(new Set(n.map((x) => x.category))).toEqual(new Set(schema.properties.category.enum)); for (const x of n) { expect(v(x), JSON.stringify(v.errors)).toBe(true); expect(Object.keys(x)).not.toContain('title'); expect(x.title_key).toMatch(/^notif\.[a-z_]+\.title$/); }
  });
  it('nothing in dev/ looks like a secret', () => { const walk = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)])); for (const f of walk(join(ROOT, 'dev'))) { const t = readFileSync(f, 'utf8'); for (const p of SECRET_PATTERNS) expect(new RegExp(p.regex).test(t), `${f} ${p.id}`).toBe(false); } });
});

describe('fixture repo', () => {
  it('the same flags give the same HEAD in different folders; --dirty leaves one modified file; --branches 3 makes three branches', () => {
    const git = (d: string, ...a: string[]) => execFileSync('git', a, { cwd: d }).toString().trim(); const a = makeFixtureRepo(join(tmp(), 'r'), { branches: 3, dirty: true }); const b = makeFixtureRepo(join(tmp(), 'r'), { branches: 3, dirty: true });
    expect(git(a, 'rev-parse', 'HEAD')).toBe(git(b, 'rev-parse', 'HEAD')); expect(git(a, 'rev-list', '--count', 'HEAD')).toBe('3'); expect(git(a, 'status', '--porcelain').split('\n')).toEqual(['M src/b.ts']); expect(git(a, 'branch', '--list', 'feature/*').split('\n')).toHaveLength(3);
    const clean = makeFixtureRepo(join(tmp(), 'c')); expect(git(clean, 'status', '--porcelain')).toBe(''); expect(git(clean, 'rev-parse', 'HEAD')).toBe(git(a, 'rev-parse', 'HEAD'));
    expect(() => makeFixtureRepo(a)).toThrow(/not empty/);
  });
  it('the command line prints the path and refuses bad input', () => { const dir = join(tmp(), 'cli'); expect(execFileSync('node', [join(ROOT, 'tools/dev/make-fixture-repo.mjs'), dir, '--branches', '2']).toString().trim()).toBe(dir); expect(() => execFileSync('node', [join(ROOT, 'tools/dev/make-fixture-repo.mjs')], { stdio: 'pipe' })).toThrow(); expect(() => execFileSync('node', [join(ROOT, 'tools/dev/make-fixture-repo.mjs'), join(tmp(), 'x'), '--branches', '999'], { stdio: 'pipe' })).toThrow(); });
});

describe('example config', () => {
  it('both sample files load with no warnings', async () => {
    const warns: string[] = []; const cfg = await loadConfig(defaultDeps({ env: { CENTCOM_CONFIG_DIR: join(ROOT, 'dev/example-config'), HOME: tmp() }, homedir: tmp(), cwd: join(ROOT, 'dev/example-config/project'), warn: (c, k) => warns.push(`${c} ${k ?? ''}`) })); expect(warns).toEqual([]); expect(cfg.api.base_url).toBe('http://127.0.0.1:8787'); expect(cfg.agent.max_parallel).toBe(2);
  });
});

describe('pnpm dev:mock', () => {
  it('prints reachable addresses within 5 s and then the export lines', async () => {
    const t0 = Date.now(); const child = spawn(process.execPath, ['--import', 'tsx', join(ROOT, 'tools/dev/mock.mjs'), '--port', '0'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] }); const lines: string[] = []; createInterface({ input: child.stdout }).on('line', (l) => lines.push(l));
    try { while (!lines.some((l) => l.includes('Then: pnpm centcom login')) && Date.now() - t0 < 15_000) await new Promise((r) => setTimeout(r, 50)); expect(Date.now() - t0).toBeLessThan(5000); const u = JSON.parse(lines[0]!); expect((await fetch(u.http + '/v1/status')).status).toBe(200); const text = lines.join('\n'); expect(text).toContain(`export CENTCOM_API_URL=${u.http}`); expect(text).toContain(`export CENTCOM_RELAY_URL=${u.ws}`); expect(text).toContain('CENTCOM_CONFIG_DIR=.dev/config'); expect(text).toContain('CENTCOM_STATE_DIR=.dev/state'); }
    finally { child.kill('SIGINT'); await new Promise((r) => child.once('exit', r)); }
  }, 30_000);
});
