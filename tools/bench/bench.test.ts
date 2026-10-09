import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { REGRESSION_RATIO, breaches, judge, normalise, table, type Baseline, type BenchResults, type Result } from './compare.js';
import { calibrate, percentile, summarize } from './stats.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const raw = (o: Partial<Result> = {}) => ({ id: 'm', unit: 'ms' as const, p50: 1, p95: 1.2, max: 2, cv: 0.02, budget: 10 as number | null, gated: true, ...o });

describe('statistics', () => {
  it('percentiles, mean and spread; the middle 80 % judges noise', () => { expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50)).toBe(5); expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBe(10); const s = summarize([...Array(18).fill(1), 100, 100]); expect(s.p50).toBe(1); expect(s.cv).toBeLessThan(0.01); expect(summarize([1, 3]).cv).toBeGreaterThan(0.5); expect(summarize([]).p50).toBeNaN(); });
  it('the calibration loop takes a steady, positive time', () => { const best = () => Math.min(calibrate(2), calibrate(2)); /* the fastest of several: load only slows a run down */ const a = best(); const b = best(); expect(a).toBeGreaterThan(0); expect(Math.abs(a - b) / a).toBeLessThan(0.75); }, 30_000);
});

describe('normalisation', () => {
  it('a machine twice as slow as the reference has its times halved and its rates doubled; memory is left alone', () => { expect(normalise(10, 'ms', 200, 100)).toBe(5); expect(normalise(1000, 'ops/s', 200, 100)).toBe(2000); expect(normalise(250, 'MB', 200, 100)).toBe(250); expect(normalise(10, 'ms', 100, 100)).toBe(10); });
  it('judging uses the normalised value: slow hardware does not break a budget it would meet on the reference runner', () => { expect(judge(raw({ p95: 12 }), undefined, 200, 100).status).toBe('pass'); expect(judge(raw({ p95: 12 }), undefined, 100, 100).status).toBe('fail'); expect(judge(raw({ p95: 12 }), undefined, 100, 200).status).toBe('fail'); });
});

describe('regression detection', () => {
  const base = { p50: 1, budget: 10, unit: 'ms' as const, gated: true };
  it('over budget fails; clearly slower than the baseline regresses; close to it passes; noise is reported, not gated', () => {
    expect(judge(raw({ p95: 11 }), base, 100, 100).status).toBe('fail'); expect(judge(raw({ p50: 1.25, p95: 1.5 }), base, 100, 100).status).toBe('regressed'); expect(judge(raw({ p50: 1.1, p95: 1.3 }), base, 100, 100).status).toBe('pass'); expect(REGRESSION_RATIO).toBeGreaterThan(1.05);
    expect(judge(raw({ p50: 1.5, cv: 0.5 }), base, 100, 100).status).toBe('unstable'); expect(judge(raw({ p95: 50, cv: 0.5 }), base, 100, 100).status).toBe('fail'); /* a budget is absolute */
  });
  it('for rates, lower is worse', () => { const b = { p50: 1000, budget: 800, unit: 'ops/s' as const, gated: true }; expect(judge(raw({ unit: 'ops/s', p50: 1000, p95: 900, budget: 800 }), b, 100, 100).status).toBe('pass'); expect(judge(raw({ unit: 'ops/s', p50: 700, p95: 700, budget: 800 }), b, 100, 100).status).toBe('fail'); expect(judge(raw({ unit: 'ops/s', p50: 850, p95: 850, budget: 800 }), b, 100, 100).status).toBe('regressed'); });
  it('only gated metrics make the run fail', () => { const res: BenchResults = { schema_version: 1, machine: { cpu: 'x', cores: 1, node: 'v22' }, calibration_ms: 100, results: [judge(raw({ id: 'a', p95: 50 }), undefined, 100, 100), judge(raw({ id: 'b', p95: 50, gated: false }), undefined, 100, 100), judge(raw({ id: 'c' }), undefined, 100, 100)] }; expect(breaches(res).map((r) => r.id)).toEqual(['a']); expect(breaches(res, { schema_version: 1, reference_calibration_ms: 100, entries: { b: { p50: 1, budget: 10, unit: 'ms', gated: true } } }).map((r) => r.id)).toEqual(['a', 'b']); });
  it('the comparison table names each metric and the change', () => { const mk = (p50: number): BenchResults => ({ schema_version: 1, machine: { cpu: 'x', cores: 1, node: 'v22' }, calibration_ms: 100, results: [judge(raw({ id: 'transcript.scroll.frame', p50, p95: p50 }), undefined, 100, 100)] }); const t = table(mk(2), mk(1)).join('\n'); expect(t).toContain('transcript.scroll.frame'); expect(t).toContain('+100%'); });
});

describe('the results file and the self-test of the gate', () => {
  it('bench-results.json has the documented shape', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cc-bench-')); const out = join(dir, 'r.json'); execFileSync('pnpm', ['-s', 'bench', '--fast', '--filter', 'envelope', '--out', out, '--baseline', join(dir, 'none.json')], { cwd: ROOT, stdio: 'pipe', env: { ...process.env, PATH: `${process.env.HOME}/.local/bin:${process.env.PATH}` } });
    const r = JSON.parse(readFileSync(out, 'utf8')) as BenchResults; expect(r.schema_version).toBe(1); expect(r.machine).toMatchObject({ cores: expect.any(Number), node: expect.stringMatching(/^v22/) }); expect(r.calibration_ms).toBeGreaterThan(0); expect(r.results[0]).toMatchObject({ id: 'envelope.parse', unit: 'ms', status: expect.stringMatching(/pass|unstable/), budget: 0.5, baseline: null }); for (const k of ['p50', 'p95', 'max']) expect((r.results[0] as unknown as Record<string, number>)[k]).toBeGreaterThanOrEqual(0);
  }, 60_000);
  it('a clear slowdown injected into the transcript renderer makes the run exit 1 and name the metric', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cc-bench-')); const base = join(dir, 'baseline.json'); const env = { ...process.env, PATH: `${process.env.HOME}/.local/bin:${process.env.PATH}` }; const run = (extra: string[], e = env) => spawnSync('pnpm', ['-s', 'bench', '--fast', '--filter', 'transcript.scroll', '--baseline', base, '--out', join(dir, 'r.json'), ...extra], { cwd: ROOT, encoding: 'utf8', env: e });
    expect(run(['--update-baseline']).status).toBe(0); expect(JSON.parse(readFileSync(base, 'utf8')).entries['transcript.scroll.frame']).toMatchObject({ unit: 'ms', gated: true });
    const slow = run([], { ...env, CENTCOM_BENCH_SLOWDOWN_TRANSCRIPT: '1.6' }); expect(slow.status).toBe(1); expect(slow.stderr).toContain('transcript.scroll.frame'); writeFileSync(join(dir, 'ok'), '');
  }, 120_000);
});

describe('baseline changes need a reason', () => {
  it('the commit check script refuses a baseline change without a "Baseline:" line', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cc-bl-')); const git = (...a: string[]) => execFileSync('git', a, { cwd: dir, env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' }, stdio: 'pipe' }).toString();
    git('init', '-q', '-b', 'main'); writeFileSync(join(dir, 'x'), '1'); git('add', '.'); git('commit', '-qm', 'base'); execFileSync('mkdir', ['-p', join(dir, 'tools/bench')]); writeFileSync(join(dir, 'tools/bench/baseline.json'), '{}'); git('add', '.'); git('commit', '-qm', 'update baseline');
    const check = () => spawnSync('node', [join(ROOT, 'tools/bench/check-baseline-commit.mjs'), 'HEAD~1'], { cwd: dir, encoding: 'utf8' }); expect(check().status).toBe(1); writeFileSync(join(dir, 'tools/bench/baseline.json'), '{"a":1}'); git('add', '.'); git('commit', '-qm', 'Tune it\n\nBaseline: the transcript layout got a cache, so frames are 3x faster'); expect(spawnSync('node', [join(ROOT, 'tools/bench/check-baseline-commit.mjs'), 'HEAD~1'], { cwd: dir, encoding: 'utf8' }).status).toBe(0);
  });
});
