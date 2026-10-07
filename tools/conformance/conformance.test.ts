import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildReport, exitCode, loadFixtures, runSuites, validateReport, validateWaivers, type ContractReport, type Suite } from '../../packages/testkit/src/index.js';
import { allowConsole } from '../../packages/testkit/src/index.js';
import { conformance } from './run.js';
import { SUITES } from './suites.js';

const NOW = Date.UTC(2026, 9, 7, 12, 0, 0); const DAY = 86_400_000; const ymd = (t: number) => new Date(t).toISOString().slice(0, 10);
const rep = (contracts: ContractReport[]) => buildReport({ contracts, clientVersion: '0.1.0', contractVersion: '2026.10.0', now: new Date(NOW), node: '22.0.0', os: 'linux', arch: 'x64' });
const pass = (id: string): ContractReport => ({ id, status: 'pass', fixtures_total: 1, fixtures_passed: 1 });

describe('report', () => {
  it('a built report validates against its schema; malformed ones are rejected', () => {
    const r = rep([pass('CT-IDS'), { id: 'CT-ERR', status: 'fail', fixtures_total: 2, fixtures_passed: 1, failures: ['x'] }, { id: 'CT-LAN', status: 'waived', fixtures_total: 0, fixtures_passed: 0, waiver: { issue: 'I-1', reason: 'r', expires: '2026-11-01' } }]);
    expect(validateReport(r)).toEqual({ ok: true, errors: [] }); expect(r.summary).toEqual({ total: 3, passed: 1, failed: 1, skipped: 1 });
    for (const bad of [{ ...r, schema_version: 2 }, { ...r, generated_at: 'yesterday' }, { ...r, contracts: [{ id: 'ids', status: 'pass', fixtures_total: 0, fixtures_passed: 0 }] }, { ...r, contracts: [{ id: 'CT-IDS', status: 'maybe', fixtures_total: 0, fixtures_passed: 0 }] }, { ...r, extra: 1 }, { ...r, summary: { total: 1 } }, null, 'x']) expect(validateReport(bad).ok).toBe(false);
  });
  it('exit codes: 0 pass, 1 any failure, 3 a strict violation', () => {
    const impl = ['CT-IDS', 'CT-LAN']; const ok = rep([pass('CT-IDS'), { id: 'CT-LAN', status: 'skipped', fixtures_total: 0, fixtures_passed: 0 }]);
    expect(exitCode(ok, { strict: false, implemented: impl })).toBe(0); expect(exitCode(ok, { strict: true, implemented: impl })).toBe(3); expect(exitCode(rep([{ id: 'CT-IDS', status: 'fail', fixtures_total: 1, fixtures_passed: 0 }]), { strict: true, implemented: impl })).toBe(1);
    expect(exitCode(rep([pass('CT-IDS'), { id: 'CT-LAN', status: 'waived', fixtures_total: 0, fixtures_passed: 0 }]), { strict: true, implemented: impl })).toBe(0);
  });
});

describe('fixtures loader', () => {
  it('reads every area of the real corpus; a missing folder is an empty area, which the runner reports as skipped, not as a pass', async () => {
    const real = loadFixtures(join(import.meta.dirname, '../../contracts')); expect(real.area('events').length).toBeGreaterThanOrEqual(45); for (const a of ['crypto', 'envelope', 'problem', 'telemetry', 'lan']) expect(real.area(a).length).toBeGreaterThan(0);
    const dir = mkdtempSync(join(tmpdir(), 'cc-fx-')); mkdirSync(join(dir, 'fixtures', 'lan'), { recursive: true }); writeFileSync(join(dir, 'fixtures', 'lan', 'a.json'), '{"x":1}'); const f = loadFixtures(dir); expect(f.area('lan')).toHaveLength(1); expect(f.area('events')).toEqual([]); expect(loadFixtures(join(dir, 'nowhere')).all).toEqual([]);
    const empty: Suite = { contract: 'CT-LAN', areas: ['lan'], run: ({ fixtures }) => ({ fixtures_total: fixtures.area('events').length, fixtures_passed: 0, cases: [] }) };
    const out = await runSuites({ suites: [empty], contracts: ['CT-LAN', 'CT-IDS'], ctx: { fixtures: f, contractsDir: dir }, waivers: [] }); expect(out.map((c) => c.status)).toEqual(['skipped', 'skipped']);
  });
  it('a suite that crashes is a failure, not a skip', async () => { const boom: Suite = { contract: 'CT-LAN', areas: [], run: () => { throw new Error('kaput'); } }; const [c] = await runSuites({ suites: [boom], contracts: ['CT-LAN'], ctx: { fixtures: loadFixtures('/nope'), contractsDir: '/nope' }, waivers: [] }); expect(c).toMatchObject({ status: 'fail' }); expect(c!.failures![0]).toContain('kaput'); });
});

describe('waivers', () => {
  const w = (o: object) => ({ contract: 'CT-LAN', reason: 'r', issue: 'I-1', expires: ymd(NOW + 30 * DAY), ...o });
  it('a good waiver is kept; one over 60 days, an expired one, and malformed ones are not', () => {
    expect(validateWaivers([w({})], NOW)).toEqual({ valid: [w({})], problems: [] });
    expect(validateWaivers([w({ expires: ymd(NOW + 61 * DAY) })], NOW).problems[0]).toMatch(/60 days/); expect(validateWaivers([w({ expires: ymd(NOW - 2 * DAY) })], NOW)).toEqual({ valid: [], problems: [] });
    expect(validateWaivers([w({ expires: 'soon' })], NOW).problems).toHaveLength(1); expect(validateWaivers([w({ issue: '' })], NOW).problems).toHaveLength(1); expect(validateWaivers([w({ contract: 'lan' })], NOW).problems).toHaveLength(1); expect(validateWaivers({}, NOW).problems).toHaveLength(1);
  });
  it('an expired waiver no longer excuses a contract without fixtures (strict exits 3)', async () => {
    const none: Suite = { contract: 'CT-LAN', areas: [], run: () => ({ fixtures_total: 0, fixtures_passed: 0, cases: [] }) }; const ctx = { fixtures: loadFixtures('/nope'), contractsDir: '/nope' };
    const live = validateWaivers([w({})], NOW).valid; const dead = validateWaivers([w({ expires: ymd(NOW - 2 * DAY) })], NOW).valid;
    const a = await runSuites({ suites: [none], contracts: ['CT-LAN'], ctx, waivers: live }); const b = await runSuites({ suites: [none], contracts: ['CT-LAN'], ctx, waivers: dead });
    expect(a[0]!.status).toBe('waived'); expect(b[0]!.status).toBe('skipped'); expect(exitCode(rep(a), { strict: true, implemented: ['CT-LAN'] })).toBe(0); expect(exitCode(rep(b), { strict: true, implemented: ['CT-LAN'] })).toBe(3);
  });
});

describe('the real run', () => {
  it('every suite passes against the shared fixtures, offline, and the report validates', async () => {
    const lines: string[] = []; const out = join(mkdtempSync(join(tmpdir(), 'cc-rep-')), 'r.json'); const code = await conformance(['--json', '--out', out], new Date(NOW), (l) => lines.push(l)); expect(code).toBe(0);
    const r = JSON.parse(lines[0]!); expect(validateReport(r).ok).toBe(true); expect(r.summary.failed).toBe(0); const by = Object.fromEntries(r.contracts.map((c: ContractReport) => [c.id, c]));
    expect(by['CT-WS-SESSION-EVENTS'].fixtures_total).toBeGreaterThanOrEqual(45); expect(by['CT-CRYPTO'].status).toBe('pass'); expect(by['CT-STATE-MAP'].status).toBe('pass');
  }, 60_000);
  it('--contract runs only that contract; an unknown one is a usage error; --strict passes while the waivers hold', async () => {
    allowConsole(); /* the usage error is printed to stderr on purpose */
    const lines: string[] = []; expect(await conformance(['--json', '--contract', 'CT-WS-QUEUE'], new Date(NOW), (l) => lines.push(l))).toBe(0); expect(JSON.parse(lines[0]!).contracts.map((c: ContractReport) => c.id)).toEqual(['CT-WS-QUEUE']); expect(await conformance(['--contract', 'CT-NOPE'], new Date(NOW), () => undefined)).toBe(2);
    expect(await conformance(['--strict', '--json'], new Date(NOW), () => undefined)).toBe(0); expect(await conformance(['--strict', '--json'], new Date(NOW + 90 * DAY), () => undefined)).toBe(3);
  });
  it('the suites catch a broken fixture: a bad id, a wrong crypto vector and a tampered event are failures', async () => {
    const fx = loadFixtures(join(import.meta.dirname, '../../contracts')); const ctx = { fixtures: fx, contractsDir: join(import.meta.dirname, '../../contracts') }; const suite = (id: string) => SUITES.find((s) => s.contract === id)!;
    const bad = { ...fx, area: (n: string) => fx.area(n).map((f) => (f.file === 'crypto/vectors.json' ? { ...f, json: { ...(f.json as object), fingerprint: 'AAAA-AAAA-AAAA' } } : f)) }; const c = await suite('CT-CRYPTO').run({ ...ctx, fixtures: bad }); expect(c.cases.some((x) => !x.ok)).toBe(true);
    const ev = { ...fx, area: (n: string) => fx.area(n).map((f) => (f.file === 'events/agent.state.json' ? { ...f, json: { ...(f.json as { frame: object }), frame: { v: 7, t: 'event' } } } : f)) }; expect((await suite('CT-WS-SESSION-EVENTS').run({ ...ctx, fixtures: ev })).cases.some((x) => !x.ok)).toBe(true);
    const env = { ...fx, area: (n: string) => fx.area(n).map((f) => (f.file === 'envelope/hello.json' ? { ...f, json: { ...(f.json as object), valid: false } } : f)) }; expect((await suite('CT-WS-ENVELOPE').run({ ...ctx, fixtures: env })).cases.some((x) => !x.ok)).toBe(true);
  });
});
