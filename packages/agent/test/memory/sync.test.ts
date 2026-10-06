import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { MemoryConflict, MemoryError, applyRegion, buildRegion, findRegion } from '../../src/index.js';
import { confirm, rig } from './helpers.js';

const OUT = Array.from({ length: 100 }, (_x, i) => `line ${i} outside the markers`).join('\n');
const setup = (o: { claude?: string; agents?: string; source?: string } = {}) => rig({ sync: true, files: { 'CLAUDE.md': o.claude ?? OUT + '\n', 'AGENTS.md': o.agents ?? OUT + '\n', '.centcom/memory.md': o.source ?? '# Shared\n\n- use pnpm\n' } });
const doSync = async (r: ReturnType<typeof setup>) => { const plan = await r.mf.sync({ direction: 'source_to_targets', root: r.root }); await r.mf.apply(plan, confirm(plan)); return plan; };

describe('sync', () => {
  it('rewrites only the marked region; 100 lines outside stay byte-identical; a second run has an empty diff', async () => {
    const r = setup(); const plan = await doSync(r); expect(plan.targets.map((t) => t.engine).sort()).toEqual(['claude-code', 'codex']);
    for (const p of [r.claude, r.agents]) { const t = r.mem.text(p)!; expect(t.startsWith(OUT + '\n')).toBe(true); const f = findRegion(t)!; expect(f.body).toBe('# Shared\n\n- use pnpm'); expect(t.slice(0, f.start) + t.slice(f.end)).toBe(OUT + '\n\n\n'); }
    const again = await r.mf.sync({ direction: 'source_to_targets', root: r.root }); expect(again.diff).toBe(''); expect(again.targets).toEqual([]); expect((await r.mf.status(r.root)).state).toBe('in_sync');
  });
  it('after the source changes only the region moves; text the person wrote above and below it is never touched', async () => {
    const r = setup(); await doSync(r); r.mem.files.set(r.claude, Buffer.from('TOP\n' + r.mem.text(r.claude) + '\nBOTTOM written later\n')); r.mem.files.set(r.source, Buffer.from('# Shared v2\n')); expect((await r.mf.status(r.root)).state).toBe('source_changed'); await doSync(r);
    const t = r.mem.text(r.claude)!; expect(t.startsWith('TOP\n' + OUT)).toBe(true); expect(t.endsWith('\nBOTTOM written later\n')).toBe(true); expect(findRegion(t)!.body).toBe('# Shared v2'); expect(t.match(/centcom:memory:begin/g)).toHaveLength(1);
  });
  it('sync is off by default and refuses; with no source file there is nothing to do', async () => {
    const off = rig({ files: { 'CLAUDE.md': 'x', '.centcom/memory.md': 's' } }); expect((await off.mf.status(off.root)).state).toBe('disabled'); await expect(off.mf.sync({ direction: 'source_to_targets', root: off.root })).rejects.toMatchObject({ code: 'disabled' });
    const none = rig({ sync: true, files: { 'CLAUDE.md': 'x' } }); expect((await none.mf.status(none.root)).state).toBe('disabled'); await expect(none.mf.sync({ direction: 'source_to_targets', root: none.root })).rejects.toBeInstanceOf(MemoryError);
  });
  it('CRLF files get a CRLF region and stay consistent', async () => { const r = setup({ claude: 'a\r\nb\r\n', agents: 'x\n' }); await doSync(r); const t = r.mem.text(r.claude)!; expect(t.replace(/\r\n/g, '')).not.toContain('\n'); expect((await r.mf.status(r.root)).state).toBe('in_sync'); const again = await r.mf.sync({ direction: 'source_to_targets', root: r.root }); expect(again.diff).toBe(''); });
  it('property: any outside text survives, and sync is idempotent', () => {
    fc.assert(fc.property(fc.string({ maxLength: 300 }).filter((s) => !s.includes('centcom:memory')), fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.trim().length > 0 && !s.includes('centcom:memory')), (outside, src) => {
      const once = applyRegion(outside, src); const f = findRegion(once)!; expect(once.slice(0, f.start).startsWith(outside.replace(/\s+$/, ''))).toBe(true); expect(applyRegion(once, src)).toBe(once); const edited = applyRegion(once, src + ' more'); const g = findRegion(edited)!; expect(edited.slice(0, g.start)).toBe(once.slice(0, f.start)); expect(edited.slice(g.end)).toBe(once.slice(f.end));
    }), { numRuns: 300 });
  });
  it('buildRegion embeds the checksum of the body', () => { const r = buildRegion('hello\n', '\n'); expect(findRegion(r)!.markerSha).toMatch(/^[0-9a-f]{64}$/); expect(findRegion(r)!.body).toBe('hello'); });
});

describe('drift', () => {
  it('a manual edit inside the region is target_edited; with the source also changed it is conflict', async () => {
    const r = setup(); await doSync(r); const t = r.mem.text(r.claude)!; r.mem.files.set(r.claude, Buffer.from(t.replace('- use pnpm', '- use pnpm\n- and also yarn'))); let s = await r.mf.status(r.root); expect(s.state).toBe('target_edited'); expect(s.files).toEqual([{ engine: 'claude-code', state: 'target_edited' }, { engine: 'codex', state: 'in_sync' }]);
    r.mem.files.set(r.source, Buffer.from('# Shared v3\n')); s = await r.mf.status(r.root); expect(s.state).toBe('conflict'); expect(s.files[0]!.state).toBe('conflict'); expect(s.files[1]!.state).toBe('source_changed');
  });
  it('apply refuses an ordinary edit of a file in conflict until a direction is chosen; choosing one clears it', async () => {
    const r = setup(); await doSync(r); r.mem.files.set(r.claude, Buffer.from(r.mem.text(r.claude)!.replace('- use pnpm', '- edited'))); r.mem.files.set(r.source, Buffer.from('# changed\n'));
    const quick = await r.mf.plan({ engine: 'claude-code', scope: 'project', quickAdd: 'note', root: r.root }); const err = await r.mf.apply(quick, confirm(quick)).catch((e) => e); expect(err).toBeInstanceOf(MemoryConflict); expect(err.message).toContain('direction');
    const before = r.mem.w.writes; const plan = await r.mf.sync({ direction: 'source_to_targets', root: r.root }); await r.mf.apply(plan, confirm(plan)); expect(r.mem.w.writes).toBeGreaterThan(before); expect((await r.mf.status(r.root)).state).toBe('in_sync');
  });
  it('pulling a target into the source: a diff, a confirmation, and then the other file is source_changed', async () => {
    const r = setup(); await doSync(r); r.mem.files.set(r.claude, Buffer.from(r.mem.text(r.claude)!.replace('- use pnpm', '- use pnpm\n- tabs'))); const plan = await r.mf.sync({ direction: 'target_to_source', from: 'claude-code', root: r.root }); expect(plan.targets[0]!.engine).toBe('source'); expect(plan.diff).toContain('+- tabs'); expect(r.mem.text(r.source)).toBe('# Shared\n\n- use pnpm\n');
    await r.mf.apply(plan, confirm(plan)); expect(r.mem.text(r.source)).toBe('# Shared\n\n- use pnpm\n- tabs\n'); const s = await r.mf.status(r.root); expect(s.files.find((f) => f.engine === 'codex')!.state).toBe('source_changed'); await expect(r.mf.sync({ direction: 'target_to_source', root: r.root })).rejects.toBeInstanceOf(MemoryError); const bare = setup({ agents: 'no region' }); await expect(bare.mf.sync({ direction: 'target_to_source', from: 'codex', root: bare.root })).rejects.toBeInstanceOf(MemoryError);
  });
  it('a secret in the shared source is refused and nothing is written', async () => { const r = setup({ source: 'token sk-ant-api03-' + 'B'.repeat(40) }); await expect(r.mf.sync({ direction: 'source_to_targets', root: r.root })).rejects.toMatchObject({ code: 'secret_rejected' }); expect(r.mem.w.writes).toBe(0); });
});

describe('import hint', () => {
  it('offers, never creates: with only CLAUDE.md it offers a pointer or a copy for AGENTS.md; nothing is written until confirmed', async () => {
    const r = rig({ files: { 'CLAUDE.md': '# Rules\n- a\n' } }); expect(await r.mf.importHint(r.root)).toEqual({ existing: 'claude-code', missing: 'codex', offers: ['pointer', 'copy'] }); expect(r.mem.w.writes).toBe(0);
    const ptr = await r.mf.planImport(r.root, 'pointer'); expect(ptr.targets[0]!.newText).toContain('CLAUDE.md'); const cp = await r.mf.planImport(r.root, 'copy'); expect(cp.targets[0]!.newText).toBe('# Rules\n- a\n'); await r.mf.apply(cp, confirm(cp)); expect(r.mem.text(r.agents)).toBe('# Rules\n- a\n'); expect(await r.mf.importHint(r.root)).toBeUndefined();
    expect(await rig().mf.importHint('/proj')).toBeUndefined();
  });
});
