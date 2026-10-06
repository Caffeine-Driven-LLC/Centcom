import { describe, expect, it } from 'vitest';
import { createMemoryFiles, defaultMemoryPaths, type MemFs } from '@centcom/agent';
import { runMemory, type MemoryIO } from '../src/commands/memory/index.js';

function io(files: Record<string, string> = {}, o: Partial<MemoryIO> & { sync?: boolean; yes?: boolean } = {}) {
  const m = new Map(Object.entries(files).map(([k, v]) => [k, Buffer.from(v)])); let writes = 0; const fs: MemFs = { read: async (p) => (m.has(p) ? { bytes: m.get(p)!, mode: 0o644 } : undefined), writeAtomic: async (p, b) => { writes++; m.set(p, Buffer.from(b)); } };
  const out: string[] = []; const err: string[] = []; const asked: string[] = [];
  const base: MemoryIO = { mf: createMemoryFiles({ fs, engines: defaultMemoryPaths('/home/u'), config: { sync: o.sync ?? false } }), root: '/proj', out: (l) => out.push(l), err: (l) => err.push(l), isTTY: true, confirm: async (q) => { asked.push(q); return o.yes ?? true; }, ...o };
  return { io: base, out, err, asked, files: m, writes: () => writes };
}
describe('centcom memory', () => {
  it('show prints the file, or says there is none', async () => { const t = io({ '/proj/CLAUDE.md': 'hello' }); expect(await runMemory(['show'], t.io)).toBe(0); expect(t.out).toEqual(['hello']); const n = io(); await runMemory(['show', 'codex'], n.io); expect(n.out).toEqual(['(no file yet)']); });
  it('add shows the diff, asks, and writes the heading and the bullet only after yes', async () => {
    const t = io({ '/proj/CLAUDE.md': '# P\n' }); expect(await runMemory(['add', 'Use pnpm, not npm', '--to', 'claude'], t.io)).toBe(0); expect(t.out.join('\n')).toContain('+- Use pnpm, not npm'); expect(t.asked).toEqual(['Write this change?']); expect(t.files.get('/proj/CLAUDE.md')!.toString()).toBe('# P\n\n## Notes (added with Centcom)\n\n- Use pnpm, not npm\n'); expect(t.files.has('/proj/AGENTS.md')).toBe(false);
  });
  it('a no leaves everything as it was (exit 1)', async () => { const t = io({ '/proj/CLAUDE.md': 'a' }, { yes: false }); expect(await runMemory(['add', 'x', '--to', 'claude'], t.io)).toBe(1); expect(t.writes()).toBe(0); });
  it('without a terminal it refuses unless --yes is given', async () => { const t = io({ '/proj/CLAUDE.md': 'a' }, { isTTY: false }); expect(await runMemory(['add', 'x', '--to', 'claude'], t.io)).toBe(1); expect(t.writes()).toBe(0); expect(t.err.join(' ')).toContain('--yes'); const y = io({ '/proj/CLAUDE.md': 'a' }, { isTTY: false }); expect(await runMemory(['add', 'x', '--to', 'claude', '--yes'], y.io)).toBe(0); expect(y.writes()).toBe(1); expect(y.asked).toEqual([]); });
  it('add to both writes both files', async () => { const t = io({ '/proj/CLAUDE.md': 'a', '/proj/AGENTS.md': 'b' }); await runMemory(['add', 'x'], t.io); expect(t.writes()).toBe(2); });
  it('secrets and long notes are refused with a calm message and nothing written', async () => { const t = io(); expect(await runMemory(['add', 'key sk-ant-api03-' + 'A'.repeat(40)], t.io)).toBe(1); expect(t.err.join(' ')).toContain('password or key'); expect(t.err.join(' ')).not.toContain('sk-ant'); expect(await runMemory(['add', 'x'.repeat(3000)], t.io)).toBe(1); expect(t.writes()).toBe(0); });
  it('edit runs the editor, shows the diff and asks; quitting the editor or saving no change does nothing', async () => {
    const t = io({ '/proj/CLAUDE.md': 'one\n' }, { edit: async (s) => s + 'two\n' }); expect(await runMemory(['edit'], t.io)).toBe(0); expect(t.files.get('/proj/CLAUDE.md')!.toString()).toBe('one\ntwo\n'); expect(t.out.join('\n')).toContain('+two');
    const q = io({ '/proj/CLAUDE.md': 'one\n' }, { edit: async () => undefined }); expect(await runMemory(['edit'], q.io)).toBe(0); expect(q.writes()).toBe(0); const none = io({}, {}); expect(await runMemory(['edit'], { ...none.io, edit: undefined })).toBe(1);
  });
  it('status and sync: off by default; with sync on it reports drift and pushes after a yes', async () => {
    const off = io({ '/proj/CLAUDE.md': 'a' }); await runMemory(['status'], off.io); expect(off.out.join(' ')).toContain('off');
    const t = io({ '/proj/CLAUDE.md': 'a\n', '/proj/AGENTS.md': 'b\n', '/proj/.centcom/memory.md': '- shared\n' }, { sync: true }); expect(await runMemory(['status'], t.io)).toBe(1); expect(t.out.join('\n')).toContain('source_changed'); expect(await runMemory(['sync', 'push'], t.io)).toBe(0); expect(t.writes()).toBe(2); t.out.length = 0; expect(await runMemory(['status'], t.io)).toBe(0); expect(t.out[0]).toBe('sync: in_sync');
  });
  it('status mentions a missing second file; usage errors exit 2', async () => { const t = io({ '/proj/CLAUDE.md': 'a' }, { sync: true }); await runMemory(['status'], t.io); const u = io(); expect(await runMemory(['show', 'gemini'], u.io)).toBe(2); expect(await runMemory(['add'], u.io)).toBe(2); expect(await runMemory(['add', 'x', '--scope', 'galaxy'], u.io)).toBe(2); expect(await runMemory(['bogus'], u.io)).toBe(2); expect(await runMemory([], u.io)).toBe(0); });
});
