import { describe, expect, it } from 'vitest';
import { HEALTH_TIMEOUT_MS, applyUpdate, markerPaths, recoverInterrupted, type FsPort, type RunResult, type Runner, type UpdatePlan } from '../../src/autoupdate/index.js';

/** An in-memory folder where any operation can be made to fail, and every operation is logged. */
function memFs(files: Record<string, string>, fail: Partial<Record<'copyFile' | 'rename' | 'chmod' | 'rm', (a: string, b?: string) => boolean>> = {}) {
  const log: string[] = []; const trip = (op: keyof typeof fail, a: string, b?: string) => { log.push(`${op} ${a}${b ? ` ${b}` : ''}`); if (fail[op]?.(a, b)) throw new Error(`${op} failed`); };
  const fs: FsPort = {
    exists: async (p) => p in files, readFile: async (p) => files[p]!, writeFile: async (p, d) => { files[p] = d; },
    copyFile: async (a, b) => { trip('copyFile', a, b); if (!(a in files)) throw new Error('ENOENT'); files[b] = files[a]!; },
    rename: async (a, b) => { trip('rename', a, b); if (!(a in files)) throw new Error('ENOENT'); files[b] = files[a]!; delete files[a]; },
    rm: async (p) => { trip('rm', p); delete files[p]; }, chmod: async (p) => { trip('chmod', p); },
  };
  return { fs, files, log };
}
const EXE = '/i/centcom'; const M = markerPaths(EXE);
const plan = (o: Partial<UpdatePlan> = {}): UpdatePlan => ({ exe: EXE, staged: '/i/.centcom-update.part', from: '1.4.2', to: '1.4.3', platform: 'linux', ...o });
/** A runner that answers `--version --json` with what the file at `exe` says it is. */
const runner = (files: Record<string, string>, o: { code?: number; timedOut?: boolean; out?: (exe: string) => string } = {}): Runner & { calls: string[][] } => { const calls: string[][] = []; return { calls, run: async (f, a, opt) => { calls.push([f, ...a, String(opt.timeoutMs)]); const r: RunResult = { code: o.code ?? 0, stdout: o.out ? o.out(f) : JSON.stringify({ version: files[f] }), timedOut: o.timedOut ?? false }; return r; } }; };

describe('apply: swap, health check, rollback', () => {
  it('swaps atomically, keeps .previous, runs `--version --json` on the NEW program only after the swap, and leaves nothing else', async () => {
    const m = memFs({ [EXE]: '1.4.2', '/i/.centcom-update.part': '1.4.3' }); const r = runner(m.files);
    expect(await applyUpdate(plan(), m.fs, r)).toEqual({ ok: true, from: '1.4.2', to: '1.4.3' }); expect(m.files).toEqual({ [EXE]: '1.4.3', [M.previous]: '1.4.2' });
    expect(r.calls).toEqual([[EXE, '--version', '--json', String(HEALTH_TIMEOUT_MS)]]); expect(HEALTH_TIMEOUT_MS).toBe(5000); const swap = m.log.findIndex((l) => l === `rename ${M.newFile} ${EXE}`); expect(swap).toBeGreaterThan(m.log.findIndex((l) => l === `rename ${M.tmp} ${M.previous}`));
  });
  it('a new program that fails its health check is rolled back: the old version runs again and .previous is kept', async () => {
    for (const bad of [{ code: 1 }, { timedOut: true }, { out: () => 'not json' }, { out: () => JSON.stringify({ version: '9.9.9' }) }, { out: () => '' }]) {
      const m = memFs({ [EXE]: '1.4.2', '/i/.centcom-update.part': '1.4.3' }); const r = await applyUpdate(plan(), m.fs, runner(m.files, bad));
      expect(r).toEqual({ ok: false, rolledBack: true, code: 'health_check_failed' }); expect(m.files[EXE]).toBe('1.4.2'); expect(m.files[M.previous]).toBe('1.4.2'); expect(Object.keys(m.files).sort()).toEqual([EXE, M.previous].sort());
    }
  });
  it('a rollback that itself fails is reported as such, never as success', async () => {
    const m = memFs({ [EXE]: '1.4.2', '/i/.centcom-update.part': '1.4.3' }, { copyFile: (_a, b) => b === M.restoring }); const r = await applyUpdate(plan(), m.fs, runner(m.files, { code: 1 }));
    expect(r).toEqual({ ok: false, rolledBack: false, code: 'rollback_failed' });
  });
  it('a failure before the swap leaves the current program untouched and no partial files', async () => {
    const faults: [string, Parameters<typeof memFs>[1]][] = [['chmod', { chmod: () => true }], ['stage rename', { rename: (a) => a === '/i/.centcom-update.part' }], ['previous copy (disk full)', { copyFile: () => true }], ['previous rename', { rename: (a) => a === M.tmp }], ['swap rename', { rename: (a) => a === M.newFile }]];
    for (const [name, fail] of faults) { const m = memFs({ [EXE]: '1.4.2', '/i/.centcom-update.part': '1.4.3' }, fail); const r = await applyUpdate(plan(), m.fs, runner(m.files)); expect(r, name).toEqual({ ok: false, rolledBack: false, code: 'swap_failed' }); expect(m.files[EXE], name).toBe('1.4.2'); expect(Object.keys(m.files).filter((p) => p !== EXE && p !== M.previous), name).toEqual([]); }
  });
  it('no staged file: nothing is done', async () => { const m = memFs({ [EXE]: '1.4.2' }); expect(await applyUpdate(plan(), m.fs, runner(m.files))).toEqual({ ok: false, rolledBack: false, code: 'staged_missing' }); expect(m.log).toEqual([]); });
  it('Windows: the running program is renamed away, the new one moved in, and a failed move puts the old one back', async () => {
    const m = memFs({ [EXE]: '1.4.2', '/i/.centcom-update.part': '1.4.3' }); expect(await applyUpdate(plan({ platform: 'win32' }), m.fs, runner(m.files))).toMatchObject({ ok: true }); expect(m.files[EXE]).toBe('1.4.3'); expect(M.away in m.files).toBe(false);
    const f = memFs({ [EXE]: '1.4.2', '/i/.centcom-update.part': '1.4.3' }, { rename: (a, b) => a === M.newFile && b === EXE }); expect(await applyUpdate(plan({ platform: 'win32' }), f.fs, runner(f.files))).toMatchObject({ ok: false, code: 'swap_failed' }); expect(f.files[EXE]).toBe('1.4.2');
    const h = memFs({ [EXE]: '1.4.2', '/i/.centcom-update.part': '1.4.3' }); expect(await applyUpdate(plan({ platform: 'win32' }), h.fs, runner(h.files, { code: 1 }))).toEqual({ ok: false, rolledBack: true, code: 'health_check_failed' }); expect(h.files[EXE]).toBe('1.4.2');
  });
});
describe('a process killed in the middle of a swap', () => {
  it('a leftover .new beside a working program is deleted (the swap never happened)', async () => { const m = memFs({ [EXE]: '1.4.2', [M.newFile]: '1.4.3', [M.tmp]: 'x' }); expect(await recoverInterrupted(EXE, 'linux', m.fs)).toBe('discarded'); expect(m.files).toEqual({ [EXE]: '1.4.2' }); });
  it('a missing program with a kept .previous is restored from it; a missing program with nothing is "broken"', async () => {
    const m = memFs({ [M.previous]: '1.4.2', [M.newFile]: '1.4.3' }); expect(await recoverInterrupted(EXE, 'linux', m.fs)).toBe('restored'); expect(m.files[EXE]).toBe('1.4.2'); expect(M.newFile in m.files).toBe(false); expect(m.files[M.previous]).toBe('1.4.2');
    expect(await recoverInterrupted(EXE, 'linux', memFs({}).fs)).toBe('broken');
  });
  it('Windows: a program renamed away is renamed back; a clean folder stays clean', async () => {
    const m = memFs({ [M.away]: '1.4.2', [M.newFile]: '1.4.3' }); expect(await recoverInterrupted(EXE, 'win32', m.fs)).toBe('restored'); expect(m.files).toEqual({ [EXE]: '1.4.2' });
    const c = memFs({ [EXE]: '1.4.2', [M.previous]: '1.4.1' }); expect(await recoverInterrupted(EXE, 'linux', c.fs)).toBe('clean'); expect(c.files).toEqual({ [EXE]: '1.4.2', [M.previous]: '1.4.1' });
  });
});
