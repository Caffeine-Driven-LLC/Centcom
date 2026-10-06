import { chmodSync, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { Conflict, MemoryError, PlanChanged, SecretRejected, TooLarge, addNote, applyRegion, buildRegion, createMemoryFiles, defaultMemoryPaths, findRegion, nodeMemFs, parseHashLine } from '../../src/index.js';
import { confirm, realRig, rig } from './helpers.js';

const NOTES = '## Notes (added with Centcom)';
describe('quick add', () => {
  it('adds exactly the heading and one bullet; every other byte is unchanged', async () => {
    const before = '# Project\n\nUse tabs.\n'; const r = rig({ files: { 'CLAUDE.md': before } }); const plan = await r.mf.plan({ engine: 'claude-code', scope: 'project', quickAdd: 'Use pnpm, not npm', root: r.root });
    expect(plan.targets).toHaveLength(1); const after = plan.targets[0]!.newText; expect(after.startsWith(before)).toBe(true); expect(after.slice(before.length).split('\n').filter(Boolean)).toEqual([NOTES, '- Use pnpm, not npm']);
    const added = plan.diff.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')).map((l) => l.slice(1)).filter(Boolean); expect(added).toEqual([NOTES, '- Use pnpm, not npm']); expect(plan.diff.split('\n').filter((l) => l.startsWith('-') && !l.startsWith('---'))).toEqual([]);
    await r.mf.apply(plan, confirm(plan)); expect(r.mem.text(r.claude)).toBe(after);
  });
  it('a second note goes under the same heading, after the last bullet, before the next section', () => {
    const one = addNote('# P\n', 'first'); const two = addNote(one, 'second'); expect(two).toBe(`# P\n\n${NOTES}\n\n- first\n- second\n`); expect(two.match(/## Notes/g)).toHaveLength(1);
    const mid = `# P\n\n${NOTES}\n\n- a\n\n## Other\n\ntext\n`; expect(addNote(mid, 'b')).toBe(`# P\n\n${NOTES}\n\n- a\n- b\n\n## Other\n\ntext\n`);
  });
  it('a missing file is created (after confirmation) with 0644', async () => { const r = rig(); const plan = await r.mf.plan({ engine: 'codex', scope: 'project', quickAdd: 'Prefer small PRs', root: r.root }); expect(plan.targets[0]!.baseSha).toBeNull(); expect(r.mem.w.writes).toBe(0); await r.mf.apply(plan, confirm(plan)); expect(r.mem.text(r.agents)).toBe(`${NOTES}\n\n- Prefer small PRs\n`); });
  it('both files in one go, each changed only in its own bytes', async () => { const r = rig({ files: { 'CLAUDE.md': 'a\n', 'AGENTS.md': 'b' } }); const plan = await r.mf.plan({ engine: 'both', scope: 'project', quickAdd: 'x', root: r.root }); await r.mf.apply(plan, confirm(plan)); expect(r.mem.text(r.claude)).toBe(`a\n\n${NOTES}\n\n- x\n`); expect(r.mem.text(r.agents)).toBe(`b\n\n${NOTES}\n\n- x\n`); });
  it('keeps CRLF, a missing final newline, and mixed files as they are', async () => {
    const crlf = '# P\r\n\r\nrule\r\n'; const out = addNote(crlf, 'n'); expect(out).toBe(`${crlf}\r\n${NOTES}\r\n\r\n- n\r\n`); expect(out.replace(/\r\n/g, '')).not.toContain('\n'); expect(addNote('no newline', 'n')).toBe(`no newline\n\n${NOTES}\n\n- n\n`); expect(addNote('x\r\n', 'a\r\nb')).toContain('- a b');
    const r = rig({ files: { 'CLAUDE.md': crlf } }); const plan = await r.mf.plan({ engine: 'claude-code', scope: 'project', quickAdd: 'n', root: r.root }); await r.mf.apply(plan, confirm(plan)); expect(r.mem.text(r.claude)).toBe(out);
  });
  it('property: the old bytes are always a prefix or are kept intact around the insertion', () => {
    fc.assert(fc.property(fc.string({ maxLength: 400 }), fc.string({ minLength: 1, maxLength: 60 }).filter((s) => s.trim().length > 0), (file, note) => { const out = addNote(file, note); expect(out.includes('- ' + note.replace(/\s+/g, ' ').trim())).toBe(true); expect(out.length).toBeGreaterThan(file.length); if (!/^## Notes \(added with Centcom\)/m.test(file)) expect(out.startsWith(file)).toBe(true); }), { numRuns: 300 });
  });
});

describe('edits and conflicts', () => {
  it('a file that changed between plan and apply gives Conflict with the new text, and writes nothing', async () => {
    const r = rig({ files: { 'CLAUDE.md': 'one\n' } }); const plan = await r.mf.plan({ engine: 'claude-code', scope: 'project', newText: 'two\n', root: r.root }); r.mem.files.set(r.claude, Buffer.from('someone else\n'));
    const err = await r.mf.apply(plan, confirm(plan)).catch((e) => e); expect(err).toBeInstanceOf(Conflict); expect(err.newText).toBe('someone else\n'); expect(r.mem.w.writes).toBe(0); expect(r.mem.text(r.claude)).toBe('someone else\n');
  });
  it('a file created in the meantime is a conflict too; one deleted in the meantime also', async () => {
    const r = rig(); const plan = await r.mf.plan({ engine: 'claude-code', scope: 'project', newText: 'x', root: r.root }); r.mem.files.set(r.claude, Buffer.from('appeared')); await expect(r.mf.apply(plan, confirm(plan))).rejects.toBeInstanceOf(Conflict);
    const g = rig({ files: { 'CLAUDE.md': 'a' } }); const p2 = await g.mf.plan({ engine: 'claude-code', scope: 'project', newText: 'b', root: g.root }); g.mem.files.delete(g.claude); await expect(g.mf.apply(p2, confirm(p2))).rejects.toBeInstanceOf(Conflict);
  });
  it('without accepted:true, or with a different plan hash, or a tampered plan, nothing is written', async () => {
    const r = rig({ files: { 'CLAUDE.md': 'a\n' } }); const plan = await r.mf.plan({ engine: 'claude-code', scope: 'project', newText: 'b\n', root: r.root });
    await expect(r.mf.apply(plan, { accepted: false, planHash: plan.planHash } as never)).rejects.toMatchObject({ code: 'not_confirmed' }); await expect(r.mf.apply(plan, undefined as never)).rejects.toBeInstanceOf(MemoryError); await expect(r.mf.apply(plan, { accepted: true, planHash: 'nope' })).rejects.toBeInstanceOf(PlanChanged);
    const tampered = { ...plan, targets: [{ ...plan.targets[0]!, newText: 'EVIL\n' }] }; await expect(r.mf.apply(tampered, confirm(plan))).rejects.toBeInstanceOf(PlanChanged); expect(r.mem.w.writes).toBe(0);
  });
  it('a plan with no change has an empty diff and writes nothing', async () => { const r = rig({ files: { 'CLAUDE.md': 'same' } }); const plan = await r.mf.plan({ engine: 'claude-code', scope: 'project', newText: 'same', root: r.root }); expect(plan.diff).toBe(''); expect(plan.targets).toEqual([]); await r.mf.apply(plan, confirm(plan)); expect(r.mem.w.writes).toBe(0); });
  it('read reports text, sha and existence; a binary or non-UTF-8 file is unreadable and not editable', async () => {
    const r = rig({ files: { 'CLAUDE.md': 'hi' } }); expect(await r.mf.read('claude-code', 'project', r.root)).toMatchObject({ text: 'hi', exists: true }); expect((await r.mf.read('codex', 'project', r.root)).exists).toBe(false);
    r.mem.files.set(r.agents, Buffer.from([0x89, 0x50, 0x00, 0xff])); expect((await r.mf.read('codex', 'project', r.root)).unreadable).toBe(true); await expect(r.mf.plan({ engine: 'codex', scope: 'project', quickAdd: 'x', root: r.root })).rejects.toMatchObject({ code: 'unreadable' });
  });
});

describe('guards', () => {
  it('private keys and secret-pattern strings are refused without echoing them', async () => {
    const r = rig(); const key = 'sk-ant-api03-' + 'A'.repeat(40);
    for (const text of ['-----BEGIN PRIVATE KEY-----\nMIIE', '-----BEGIN RSA PRIVATE KEY-----', `use ${key} for tests`, 'AKIAABCDEFGHIJKLMNOP']) { for (const e of [{ quickAdd: text }, { newText: `# x\n${text}\n` }]) { const err = await r.mf.plan({ engine: 'claude-code', scope: 'project', root: r.root, ...e }).catch((x) => x); expect(err, text).toBeInstanceOf(SecretRejected); expect(String(err.message)).not.toContain(text.slice(0, 12)); expect(JSON.stringify(err)).not.toContain('AAAAAAAA'); } }
    expect(r.mem.w.writes).toBe(0);
  });
  it('size caps: a 300 KiB edit and a 2049 byte note are refused; 2048 bytes and 256 KiB are fine', async () => {
    const r = rig(); await expect(r.mf.plan({ engine: 'claude-code', scope: 'project', newText: 'x'.repeat(300 * 1024), root: r.root })).rejects.toBeInstanceOf(TooLarge); await expect(r.mf.plan({ engine: 'claude-code', scope: 'project', quickAdd: 'x'.repeat(2049), root: r.root })).rejects.toBeInstanceOf(TooLarge);
    await expect(r.mf.plan({ engine: 'claude-code', scope: 'project', quickAdd: 'x'.repeat(2048), root: r.root })).resolves.toBeTruthy(); await expect(r.mf.plan({ engine: 'claude-code', scope: 'project', newText: 'x'.repeat(256 * 1024), root: r.root })).resolves.toBeTruthy(); await expect(r.mf.plan({ engine: 'claude-code', scope: 'project', quickAdd: 'é'.repeat(1025), root: r.root })).rejects.toBeInstanceOf(TooLarge); // bytes, not characters
  });
  it('a project path outside the project folder, and a missing project folder, are refused', async () => {
    const mf = createMemoryFiles({ fs: rig().mem.fs, engines: { memoryPaths: () => '/etc/passwd' }, config: { sync: false } }); await expect(mf.plan({ engine: 'claude-code', scope: 'project', newText: 'x', root: '/proj' })).rejects.toMatchObject({ code: 'unsafe_path' }); await expect(rig().mf.plan({ engine: 'claude-code', scope: 'project', newText: 'x' })).rejects.toMatchObject({ code: 'unsafe_path' });
    const none = createMemoryFiles({ fs: rig().mem.fs, engines: { memoryPaths: () => undefined }, config: { sync: false } }); await expect(none.plan({ engine: 'codex', scope: 'user', newText: 'x' })).rejects.toMatchObject({ code: 'no_path' });
  });
  it('logs carry counts and kinds only, never the memory text', async () => { const r = rig({ files: { 'CLAUDE.md': 'a' } }); const plan = await r.mf.plan({ engine: 'claude-code', scope: 'project', quickAdd: 'a very private note', root: r.root }); await r.mf.apply(plan, confirm(plan)); expect(r.logs.join('')).toContain('memory.applied'); expect(r.logs.join('')).not.toContain('private'); });
  it('user-scope files come from the adapter paths and nothing else under the home folder is touched', async () => {
    const r = rig(); const plan = await r.mf.plan({ engine: 'claude-code', scope: 'user', quickAdd: 'x' }); expect(plan.targets[0]!.path).toBe('/home/u/.claude/CLAUDE.md'); await r.mf.apply(plan, confirm(plan)); expect([...r.mem.files.keys()]).toEqual(['/home/u/.claude/CLAUDE.md']);
  });
});

describe('atomic writes (real files)', () => {
  it('a crash between the temp write and the rename leaves the old file intact and no temp file behind', async () => {
    const { root } = realRig({ 'CLAUDE.md': 'old\n' }); const boom = nodeMemFs({ beforeRename: () => { throw new Error('crash'); } }); const mf = createMemoryFiles({ fs: boom, engines: defaultMemoryPaths('/h'), config: { sync: false } });
    const plan = await mf.plan({ engine: 'claude-code', scope: 'project', newText: 'new\n', root }); await expect(mf.apply(plan, confirm(plan))).rejects.toThrow('crash'); expect(readFileSync(join(root, 'CLAUDE.md'), 'utf8')).toBe('old\n'); expect(readdirSync(root).filter((n) => n.endsWith('.tmp'))).toEqual([]);
  });
  it('the mode of an existing file is kept; a new file gets 0644', async () => {
    const { root } = realRig({ 'CLAUDE.md': 'old\n' }); chmodSync(join(root, 'CLAUDE.md'), 0o600); const mf = createMemoryFiles({ fs: nodeMemFs(), engines: defaultMemoryPaths('/h'), config: { sync: false } });
    for (const engine of ['claude-code', 'codex'] as const) { const plan = await mf.plan({ engine, scope: 'project', quickAdd: 'n', root }); await mf.apply(plan, confirm(plan)); }
    expect(statSync(join(root, 'CLAUDE.md')).mode & 0o777).toBe(0o600); expect(statSync(join(root, 'AGENTS.md')).mode & 0o777).toBe(0o644); expect(readFileSync(join(root, 'CLAUDE.md'), 'utf8')).toContain('- n');
  });
});

describe('hash routing', () => { it('`# text` is a memory note; `#hashtag`, `#`, `##` headings and plain text are prompts', () => { expect(parseHashLine('# remember tabs')).toEqual({ kind: 'memory_add', text: 'remember tabs' }); expect(parseHashLine('#   spaced  ')).toEqual({ kind: 'memory_add', text: 'spaced' }); for (const l of ['#hashtag', '#', '# ', '## heading', 'plain', ' #x']) expect(parseHashLine(l).kind, l).toBe('prompt'); }); });
void existsSync; void applyRegion; void buildRegion; void findRegion;
