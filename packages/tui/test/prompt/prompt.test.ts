import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PasteStore, TextBuffer, checkSubmit, continuesLine, createHistoryStore, createSlashRegistry, registerBuiltins, textWidth } from '../../src/prompt/index.js';

describe('text buffer', () => {
  it('typing héllo 👩‍💻 then backspace twice removes the emoji as one unit, then the o', () => {
    const b = new TextBuffer(); b.insert('héllo 👩‍💻'); b.backspace(); expect(b.text).toBe('héllo '); b.backspace(); expect(b.text).toBe('héllo'); expect(b.cursor).toBe(5);
  });
  it('moves and deletes by whole clusters, in the middle too', () => { const b = new TextBuffer('a👨‍👩‍👧b'); b.cursor = 0; b.right(); b.right(); expect(b.text.slice(0, b.cursor)).toBe('a👨‍👩‍👧'); b.left(); expect(b.cursor).toBe(1); b.deleteForward(); expect(b.text).toBe('ab'); });
  it('cursor columns count wide characters twice', () => { expect(textWidth('ab')).toBe(2); expect(textWidth('日本')).toBe(4); expect(textWidth('👩‍💻')).toBe(2); expect(textWidth('é')).toBe(1); const b = new TextBuffer('日本x'); expect(b.cursorPos(80)).toEqual({ row: 0, col: 5 }); });
  it('wraps by columns and keeps explicit newlines; the cursor row follows', () => {
    const b = new TextBuffer('abcdef\nxy'); expect(b.lines(4)).toEqual(['abcd', 'ef', 'xy']); expect(b.cursorPos(4)).toEqual({ row: 2, col: 2 }); expect(new TextBuffer('日本語').lines(4)).toEqual(['日本', '語']);
  });
  it('words and line keys', () => {
    const b = new TextBuffer('one two three'); b.moveWord(-1); expect(b.cursor).toBe(8); b.moveWord(-1); expect(b.cursor).toBe(4); b.moveWord(1); expect(b.cursor).toBe(7); b.deleteWord(); expect(b.text).toBe('one  three');
    const c = new TextBuffer('ab\ncd ef'); c.killToLineStart(); expect(c.text).toBe('ab\n'); c.cursor = 0; c.lineEnd(); expect(c.cursor).toBe(2); c.lineStart(); expect(c.cursor).toBe(0);
  });
});

describe('submit rules', () => {
  it('empty or blank is not sent; over 65,536 characters is refused with the message; trailing backslash continues the line', () => {
    expect(checkSubmit('  \n ')).toEqual({ ok: false }); expect(checkSubmit('hi')).toEqual({ ok: true, text: 'hi' }); expect(checkSubmit('x'.repeat(65_536)).ok).toBe(true); expect(checkSubmit('x'.repeat(65_537))).toEqual({ ok: false, error: 'Message is too long (max 65,536 characters).' }); expect(continuesLine('abc\\')).toBe(true); expect(continuesLine('abc')).toBe(false);
  });
});

describe('paste', () => {
  it('50 lines become one chip that expands on send', () => {
    const p = new PasteStore(); const text = Array.from({ length: 50 }, (_, i) => `line ${i}`).join('\n'); const r = p.add(text); expect(r.insert).toBe('[Pasted text #1 +49 lines]'); const msg = `look at ${r.insert} please`; expect(p.expand(msg)).toBe(`look at ${text} please`); expect(p.pastes(msg)).toHaveLength(1); expect(p.pastes('nothing')).toHaveLength(0);
  });
  it('a short paste goes in as it is; a long single line (2,000+ characters) is a chip too; chips are numbered', () => { const p = new PasteStore(); expect(p.add('a\nb').insert).toBe('a\nb'); expect(p.add('x'.repeat(2001)).insert).toBe('[Pasted text #1 +0 lines]'); expect(p.add('y\n'.repeat(20)).insert).toBe('[Pasted text #2 +20 lines]'); });
  it('300 KiB keeps only the first 256 KiB and warns', () => { const p = new PasteStore(); const r = p.add('z'.repeat(300 * 1024)); expect(r.warning).toMatch(/256 KiB/); expect(Buffer.byteLength(p.expand(r.insert))).toBe(256 * 1024); expect(p.add('more\n'.repeat(20)).warning).toBeDefined(); });
});

describe('history', () => {
  const store = (project = '/p', max?: number) => { const dir = mkdtempSync(join(tmpdir(), 'cc-hist-')); const path = join(dir, 'history.jsonl'); return { path, make: (pr = project) => createHistoryStore({ path, project: pr, max }) }; };
  it('after a, b, b: up twice gives b then a; another project is not offered; file is private', () => {
    const s = store(); const h = s.make(); for (const t of ['a', 'b', 'b']) h.add(t); const w = h.walker(); expect([w.up(), w.up()]).toEqual(['b', 'a']); expect(w.up()).toBe('a'); expect(w.down()).toBe('b'); expect(w.down()).toBeUndefined();
    s.make('/other').add('secret other'); expect(h.entries()).toEqual(['a', 'b']); expect(s.make('/other').entries()).toEqual(['secret other']);
    if (process.platform !== 'win32') expect(require('node:fs').statSync(s.path).mode & 0o777).toBe(0o600);
  });
  it('never more than 1,000 lines, nothing over 8 KiB, damaged lines skipped, ctrl+r search newest first', () => {
    const s = store('/p', 1000); const h = s.make(); for (let i = 0; i < 1050; i++) h.add(`m${i}`); const lines = readFileSync(s.path, 'utf8').split('\n').filter(Boolean); expect(lines.length).toBeLessThanOrEqual(1000); expect(h.entries().at(-1)).toBe('m1049'); expect(h.entries()[0]).toBe('m50');
    h.add('x'.repeat(9000)); expect(h.entries().some((e) => e.length > 8000)).toBe(false); writeFileSync(s.path, readFileSync(s.path, 'utf8') + '{broken\n'); expect(h.entries().length).toBe(1000); expect(h.search('m104')[0]).toBe('m1049'); expect(h.search('M104').length).toBeGreaterThan(0);
  });
});

describe('slash commands', () => {
  it('typing /mo lists /model first; unknown and unavailable commands say so; aliases and hidden ones work', async () => {
    const r = createSlashRegistry(); const ran: string[] = []; const cmd = (name: string, extra: object = {}) => ({ name, description: name, run: async (a: string) => { ran.push(`${name}:${a}`); return { ok: true as const }; }, ...extra });
    r.register(cmd('model')); r.register(cmd('resume')); r.register(cmd('mouse')); r.register(cmd('secret', { hidden: true })); r.register(cmd('later', { available: () => false })); registerBuiltins(r, { clear: () => ran.push('clear'), exit: () => ran.push('exit') });
    expect(r.list('/mo').map((c) => c.name)).toEqual(['model', 'mouse']); expect(r.list('').map((c) => c.name)).toEqual(['clear', 'exit', 'model', 'mouse', 'resume']); expect(r.list('rsm').map((c) => c.name)).toEqual(['resume']);
    expect((await r.run('/model sonnet')).ok).toBe(true); expect(ran).toContain('model:sonnet'); await r.run('/quit'); expect(ran).toContain('exit'); await r.run('/clear');
    expect(await r.run('/nope')).toEqual({ ok: false, message: 'Unknown command /nope. Type / to see the list.' }); expect((await r.run('/later')).ok).toBe(false); expect((await r.run('/secret')).ok).toBe(true);
  });
  it('a duplicate name is refused; unregistering frees it; a failing command is reported, not thrown', async () => {
    const r = createSlashRegistry(); const off = r.register({ name: 'x', description: 'x', run: async () => { throw new Error('boom'); } }); expect(() => r.register({ name: 'x', description: 'y', run: async () => ({ ok: true }) })).toThrow(); expect(await r.run('/x')).toEqual({ ok: false, message: '/x failed: boom' }); off(); expect(r.list()).toEqual([]);
  });
});
