import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import Ajv from 'ajv';
import { describe, expect, it } from 'vitest';
import { ALL_CHECKS, REPORT_SCHEMA, exitCodeOf, runChecks, runDoctor, type DoctorContext, type Reply } from '../../src/doctor/index.js';
import { CrashStore } from '../../src/crash/index.js';

const T0 = Date.UTC(2026, 9, 6, 12);
const status = (o: object = {}, headers: Record<string, string> = { date: new Date(T0).toUTCString() }): Reply => ({ status: 200, headers, json: { min_client_version: '0.1.0', contract_version: '1.2.0', ...o } });
function ctx(o: Partial<DoctorContext> & { replies?: Record<string, Reply | 'fail' | 'hang'> } = {}): DoctorContext {
  const replies = o.replies ?? {}; const mem = new Map<string, string>();
  return { version: '0.1.0', contract: '1.2.0', env: {}, platform: 'linux', arch: 'x64', node: 'v22.3.0', home: '/home/me', stateDir: '/home/me/.centcom', apiBase: 'https://api.test', term: { tier: 'truecolor', unicode: true, cols: 120, rows: 40, isTTY: true }, now: () => T0,
    get: async (url) => { const k = url.replace('https://api.test', ''); const r = replies[k] ?? (k === '/healthz' ? { status: 200, headers: {} } : k === '/v1/status' ? status() : 'fail'); if (r === 'hang') return new Promise<Reply>(() => undefined); if (r === 'fail') throw new Error('offline'); return r; },
    keychain: { get: async (a) => mem.get(a), set: async (a, v) => { mem.set(a, v); }, delete: async (a) => { mem.delete(a); } }, git: async () => 'git version 2.43.0', readFile: () => undefined, exists: () => false, ...o };
}
const one = async (id: string, c: DoctorContext) => (await runChecks(c, { only: [id] })).checks[0]!;

describe('each check with pass, warn and fail injected', () => {
  it('node and terminal', async () => { expect((await one('node', ctx())).status).toBe('pass'); expect(await one('node', ctx({ node: 'v20.11.0' }))).toMatchObject({ status: 'fail', next_step: expect.stringContaining('Node 22') }); expect((await one('terminal', ctx({ term: { tier: 'truecolor', unicode: true, cols: 70, rows: 20, isTTY: true } })))).toMatchObject({ status: 'warn' }); expect((await one('terminal', ctx({ term: { tier: 'truecolor', unicode: true, cols: 80, rows: 24, isTTY: false } }))).status).toBe('skip'); expect((await one('terminal', ctx({ term: { tier: 'none', unicode: true, cols: 100, rows: 30, isTTY: true } }))).status).toBe('warn'); });
  it('keychain: a round trip passes and leaves nothing; failure says what to install on Linux', async () => {
    const c = ctx(); expect((await one('keychain', c)).status).toBe('pass'); const bad = ctx({ keychain: { get: async () => undefined, set: async () => { throw new Error('no secret service'); }, delete: async () => undefined } }); expect(await one('keychain', bad)).toMatchObject({ status: 'fail', next_step: expect.stringContaining('Secret Service') });
    const wrong = ctx({ keychain: { get: async () => 'other', set: async () => undefined, delete: async () => undefined } }); expect((await one('keychain', wrong)).status).toBe('fail'); expect((await one('keychain', ctx({ platform: 'darwin', keychain: bad.keychain }))).next_step).not.toMatch(/Secret Service/);
    const kept = new Map<string, string>(); await one('keychain', ctx({ keychain: { get: async (a) => kept.get(a), set: async (a, v) => { kept.set(a, v); }, delete: async (a) => { kept.delete(a); } } })); expect(kept.size).toBe(0);
  });
  it('git: found and new enough, too old, missing', async () => { expect((await one('git', ctx())).status).toBe('pass'); expect((await one('git', ctx({ git: async () => 'git version 2.25.1' }))).status).toBe('warn'); expect((await one('git', ctx({ git: async () => undefined }))).status).toBe('warn'); });
  it('config: none, valid, broken, readable by others', async () => {
    expect((await one('config', ctx())).status).toBe('pass'); expect((await one('config', ctx({ readFile: () => ({ text: '{}', mode: 0o600 }) }))).status).toBe('pass'); expect(await one('config', ctx({ readFile: () => ({ text: '{oops', mode: 0o600 }) }))).toMatchObject({ status: 'fail' }); if (process.platform !== 'win32') expect(await one('config', ctx({ readFile: () => ({ text: '{}', mode: 0o644 }) }))).toMatchObject({ status: 'warn', next_step: expect.stringContaining('chmod 600') });
  });
  it('network: up, an error status, offline', async () => { expect((await one('network', ctx())).status).toBe('pass'); expect((await one('network', ctx({ replies: { '/healthz': { status: 503, headers: {} } } }))).status).toBe('fail'); expect(await one('network', ctx({ replies: { '/healthz': 'fail' } }))).toMatchObject({ status: 'fail', next_step: expect.stringContaining('internet') }); });
  it('version: accepted, too old, other contract, offline is skipped', async () => {
    expect((await one('version', ctx())).status).toBe('pass'); expect((await one('version', ctx({ replies: { '/v1/status': status({ min_client_version: '0.2.0' }) } })))).toMatchObject({ status: 'fail', next_step: 'update Centcom' }); expect((await one('version', ctx({ replies: { '/v1/status': status({ contract_version: '2.0.0' }) } }))).status).toBe('fail'); expect((await one('version', ctx({ replies: { '/v1/status': 'fail' } }))).status).toBe('skip');
  });
  it('clock: 5 s passes, 31 s warns, 61 s fails', async () => { const at = (s: number) => ctx({ replies: { '/v1/status': status({}, { date: new Date(T0 + s * 1000).toUTCString() }) } }); expect((await one('clock', at(5))).status).toBe('pass'); expect((await one('clock', at(31)))).toMatchObject({ status: 'warn', next_step: expect.any(String) }); expect((await one('clock', at(-61))).status).toBe('fail'); expect((await one('clock', ctx({ replies: { '/v1/status': status({}, {}) } }))).status).toBe('skip'); });
  it('every failure or warning has exactly one next step, and passes have none', async () => { const r = await runChecks(ctx({ node: 'v18.0.0', git: async () => undefined, replies: { '/healthz': 'fail' } })); for (const c of r.checks) expect(c.status === 'fail' || c.status === 'warn' ? typeof c.next_step === 'string' && c.next_step.length > 0 : c.next_step === undefined, c.id).toBe(true); expect(exitCodeOf(r)).toBe(2); });
});

describe('output and exit codes', () => {
  it('--json validates against the embedded schema; --check runs only that check; exit 0, 1 and 2', async () => {
    const out: string[] = []; const io = { out: (l: string) => out.push(l), err: () => undefined }; const code = await runDoctor(['--json'], ctx(), io); const j = JSON.parse(out[0]!); const v = new Ajv().compile(REPORT_SCHEMA); expect(v(j), JSON.stringify(v.errors)).toBe(true); expect(j.checks.map((c: { id: string }) => c.id)).toEqual(ALL_CHECKS.map((c) => c.id)); expect(code).toBe(0);
    out.length = 0; await runDoctor(['--json', '--check', 'keychain'], ctx(), io); expect(JSON.parse(out[0]!).checks.map((c: { id: string }) => c.id)).toEqual(['keychain']); expect(await runDoctor(['--check', 'git'], ctx({ git: async () => 'git version 2.10.0' }), io)).toBe(1); expect(await runDoctor(['--check', 'node'], ctx({ node: 'v18.0.0' }), io)).toBe(2);
    expect(v({ schema_version: 2, version: 'x', contract: 'y', checks: [] })).toBe(false); expect(v({ schema_version: 1, version: 'x', contract: 'y', checks: [{ id: 'a', status: 'maybe', summary: 's', duration_ms: 1 }] })).toBe(false);
  });
  it('the text form lists a line per check with one next step under each problem; bad usage is exit 2', async () => { const out: string[] = []; const err: string[] = []; const io = { out: (l: string) => out.push(l), err: (l: string) => err.push(l) }; await runDoctor([], ctx({ node: 'v18.0.0' }), io); expect(out.some((l) => l.startsWith('FAIL  node'))).toBe(true); expect(out.filter((l) => l.includes('next:'))).toHaveLength(1); expect(await runDoctor(['--wat'], ctx(), io)).toBe(2); expect(await runDoctor(['--check', 'nope'], ctx(), io)).toBe(2); expect(await runDoctor(['--timeout-ms', '5'], ctx(), io)).toBe(2); expect(err.length).toBe(3); });
  it('no path, name or token shows up in the output', async () => { const out: string[] = []; await runDoctor([], ctx({ home: '/home/alice-secret', stateDir: '/home/alice-secret/.centcom' }), { out: (l) => out.push(l), err: () => undefined }); expect(out.join('\n')).not.toMatch(/alice|secret|\/home\//); });
  it('--bundle writes a .tar.gz with the report and the crash reports, and says nothing was sent', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cc-doc-')); const store = new CrashStore(dir); store.save({ error: new Error('boom'), version: '0.1.0', contract: '1.2.0', platform: 'linux-x64', node: 'v22', now: () => T0 }); const err: string[] = []; const file = join(dir, 'r.tar.gz');
    expect(await runDoctor(['--bundle', file], ctx(), { out: () => undefined, err: (l) => err.push(l) }, { crashes: store })).toBe(0); const tar = gunzipSync(readFileSync(file)); const names = [...tar.toString('latin1').matchAll(/(doctor\.json|crashes\/[\w.-]+\.json)\0/g)].map((m) => m[1]); expect(names).toContain('doctor.json'); expect(names.some((n) => n!.startsWith('crashes/'))).toBe(true); expect(err.join(' ')).toMatch(/nothing was sent/);
  });
});

describe('a blackholed network', () => {
  it('finishes within the limit: network checks give up after their own timeout, the rest is unaffected', async () => {
    const t0 = Date.now(); const r = await runChecks(ctx({ replies: { '/healthz': 'hang', '/v1/status': 'hang' } }), { timeoutMs: 400 }); const took = Date.now() - t0; expect(took).toBeLessThan(1500); const by = Object.fromEntries(r.checks.map((c) => [c.id, c])); expect(by.network!.status).toBe('fail'); expect(by.network!.summary).toMatch(/in time/); expect(by.node!.status).toBe('pass'); expect(by.keychain!.status).toBe('pass'); expect(r.checks.length).toBe(ALL_CHECKS.length);
  });
  it('a check that throws is a failure with a next step, not a crash', async () => { const r = await runChecks(ctx(), { checks: [{ id: 'boom', run: async () => { throw new Error('oops /home/alice/x'); } }] }); expect(r.checks[0]).toMatchObject({ id: 'boom', status: 'fail' }); expect(JSON.stringify(r)).not.toContain('alice'); });
});
