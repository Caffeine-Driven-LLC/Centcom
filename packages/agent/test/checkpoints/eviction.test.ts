import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { repo, rig, sh } from './helpers.js';

const AGT = 'agt_01JTEST0000000000000000001';
const du = (dir: string) => Number(/size-pack: (\d+)/.exec(sh(dir, 'count-objects', '-v'))?.[1] ?? 0) + Number(/^size: (\d+)/m.exec(sh(dir, 'count-objects', '-v'))?.[1] ?? 0);
describe('cap and cleanup (acceptance 6)', () => {
  it('the 101st checkpoint evicts the first and deletes its protecting refs', async () => {
    const r = repo(); const t = rig(r); for (let i = 1; i <= 101; i++) { r.put('a.txt', `v${i}\n`); await t.mgr.create(`t${i}`, { promptSeq: i }); await t.mgr.endTurn(); }
    const l = t.mgr.list(); expect(l).toHaveLength(100); expect(l[0]!.n).toBe(2); expect(l.at(-1)!.n).toBe(101); const refs = sh(r.dir, 'for-each-ref', '--format=%(refname)', `refs/centcom/checkpoints/${AGT}@*`).split('\n').filter(Boolean);
    expect(refs).toHaveLength(200); expect(refs).not.toContain(`refs/centcom/checkpoints/${AGT}@1`); expect(refs).not.toContain(`refs/centcom/checkpoints/${AGT}@1.end`); await expect(t.mgr.rewind('ckp_1', 'files')).rejects.toMatchObject({ code: 'not_found' });
  }, 120_000);
  it('100 checkpoints of 1 MiB changes grow the repository by under 150 MiB', async () => {
    const r = repo(); const t = rig(r); const start = du(r.dir); for (let i = 0; i < 100; i++) { r.put('big.bin', randomBytes(1024 * 1024)); await t.mgr.create(`t${i}`, { promptSeq: i }); }
    const grownKiB = du(r.dir) - start; expect(grownKiB).toBeLessThan(150 * 1024); expect(grownKiB).toBeGreaterThan(90 * 1024);
  }, 180_000);
  it('purge removes every ref of the agent and only its own', async () => { const r = repo(); const a = rig(r); const b = rig(r, { agentId: 'agt_01JTEST0000000000000000002' }); await a.mgr.create('a', { promptSeq: 1 }); await a.mgr.endTurn(); await b.mgr.create('b', { promptSeq: 1 }); r.put('x', '1'); await a.mgr.rewind('ckp_1', 'files', { confirmedPaths: ['x'] }); await a.mgr.purge(); const left = sh(r.dir, 'for-each-ref', '--format=%(refname)', 'refs/centcom/').split('\n').filter(Boolean); expect(left.every((x) => x.includes('0002'))).toBe(true); expect(left.length).toBeGreaterThan(0); expect(a.mgr.list()).toEqual([]); });
});
describe('rewind to n then to the latest is a no-op (property)', () => {
  it('whatever the history, going back and forward again restores the exact state', async () => {
    await fc.assert(fc.asyncProperty(fc.array(fc.record({ file: fc.constantFrom('a.txt', 'src/b.ts', 'c/d/e.txt', 'new.txt'), body: fc.string({ maxLength: 20 }), del: fc.boolean() }), { minLength: 2, maxLength: 6 }), fc.nat(), async (steps, pick) => {
      const r = repo(); const t = rig(r); for (const [i, s] of steps.entries()) await t.turn(`t${i}`, i, () => { if (s.del) { try { execFileSync('rm', ['-f', `${r.dir}/${s.file}`]); } catch { /* absent */ } } else r.put(s.file, `${s.body}\n`); });
      const snap = () => { sh(r.dir, 'add', '-A'); const x = sh(r.dir, 'write-tree').trim(); sh(r.dir, 'reset', '-q'); return x; }; const original = snap(); const k = t.mgr.list()[pick % t.mgr.list().length]!;
      await t.mgr.rewind(k.id, 'files', { confirmedPaths: [] }); const latest = t.mgr.list().at(-1)!; await t.mgr.rewind(latest.id, 'files'); expect(snap()).toBe(original);
    }), { numRuns: 12 });
  }, 180_000);
});
