import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { providerDoctorChecks, type DoctorCtx } from '../../src/index.js';
import { CLAUDE_OK, CODEX_OK, rig } from './helpers.js';

const NOW = Date.parse('2026-10-06T00:00:00Z'); const get = (id: string) => providerDoctorChecks.find((c) => c.id === id)!;
const ctx = (r: ReturnType<typeof rig>, o: Partial<DoctorCtx> = {}): DoctorCtx => ({ detector: r.detector, now: () => NOW, os: 'linux', ...o });

describe('providerDoctorChecks', () => {
  it('has the ids the card names', () => { expect(providerDoctorChecks.map((c) => c.id).sort()).toEqual(['provider.claude.installed', 'provider.claude.signed_in', 'provider.claude.version', 'provider.codex.installed', 'provider.codex.signed_in', 'provider.codex.version', 'provider.leak_scan', 'provider.policy.fresh']); });
  it('a missing CLI is a warning with a next step, never a failure; dependent checks skip', async () => {
    const r = rig(CLAUDE_OK, { installed: [] }); const i = await get('provider.claude.installed').run(ctx(r)); expect(i.status).toBe('warn'); expect(i.next_step).toContain('npm install'); expect((await get('provider.claude.version').run(ctx(r))).status).toBe('skip'); expect((await get('provider.codex.signed_in').run(ctx(r))).status).toBe('skip');
  });
  it('healthy tools are ok; not signed in and out-of-range versions warn with a next step; unknown sign-in is ok', async () => {
    const r = rig({ ...CLAUDE_OK, ...CODEX_OK }); for (const id of ['provider.claude.installed', 'provider.claude.version', 'provider.claude.signed_in', 'provider.codex.version']) expect((await get(id).run(ctx(r))).status, id).toBe('ok');
    const old = rig({ ...CLAUDE_OK, '--version': { code: 0, out: '1.0.0', missing: false, timedOut: false, tooLong: false } }); expect((await get('provider.claude.version').run(ctx(old))).status).toBe('warn');
    const out = rig({ ...CODEX_OK, 'login status': { code: 1, out: 'Not logged in', missing: false, timedOut: false, tooLong: false } }); const s = await get('provider.codex.signed_in').run(ctx(out)); expect(s.status).toBe('warn'); expect(s.next_step).toContain('centcom provider login codex');
    const unk = rig({ '--version': { code: 0, out: '2.0.1', missing: false, timedOut: false, tooLong: false } }); expect((await get('provider.claude.signed_in').run(ctx(unk))).status).toBe('ok');
  });
  it('policy.fresh: ok at 179 days, warn at 181, warn when the date is missing', async () => {
    const r = rig({}); const day = 86_400_000; const at = (d: number) => new Date(NOW - d * day).toISOString();
    expect((await get('provider.policy.fresh').run(ctx(r, { policyCheckedAt: at(179) }))).status).toBe('ok'); const w = await get('provider.policy.fresh').run(ctx(r, { policyCheckedAt: at(181) })); expect(w.status).toBe('warn'); expect(w.message).toContain('181 days'); expect((await get('provider.policy.fresh').run(ctx(r))).status).toBe('warn');
  });
  it('leak_scan fails on a credential in the logs (naming the pattern, not the secret), passes on clean logs, skips without logs', async () => {
    const r = rig({}); const dir = await mkdtemp(join(tmpdir(), 'logs-')); await writeFile(join(dir, 'centcom.log'), '{"msg":"ok"}\n'); expect((await get('provider.leak_scan').run(ctx(r, { logDir: dir }))).status).toBe('ok');
    const key = 'sk-ant-api03-' + 'B'.repeat(30); await writeFile(join(dir, 'centcom.log.1'), `{"msg":"oops ${key}"}\n`); const f = await get('provider.leak_scan').run(ctx(r, { logDir: dir })); expect(f.status).toBe('fail'); expect(f.message).toContain('anthropic_api_key'); expect(JSON.stringify(f)).not.toContain(key);
    expect((await get('provider.leak_scan').run(ctx(r, { logDir: join(dir, 'missing') }))).status).toBe('skip'); expect((await get('provider.leak_scan').run(ctx(r))).status).toBe('skip');
  });
  it('only the last 500 KiB of a log is scanned', async () => { const r = rig({}); const dir = await mkdtemp(join(tmpdir(), 'logs-')); await writeFile(join(dir, 'centcom.log'), 'AKIAABCDEFGHIJKLMNOP\n' + 'x'.repeat(600 * 1024)); expect((await get('provider.leak_scan').run(ctx(r, { logDir: dir }))).status).toBe('ok'); });
});
