import { existsSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { editInEditor, isForeground, stopUntilContinued } from '../src/external.js';

const tmpEdits = () => readdirSync(tmpdir()).filter((n) => n.startsWith('centcom-edit-'));
describe('editing the prompt in your editor', () => {
  it('runs $VISUAL (else $EDITOR) on a private temporary file holding the text, and returns what you saved', () => {
    const seen: string[] = []; const r = editInEditor('first line\nsecond', { env: { VISUAL: 'nano -w', EDITOR: 'vi' }, run: (cmd) => { seen.push(cmd); const f = /'([^']+)'$/.exec(cmd)![1]!; expect(statSync(f).mode & 0o777).toBe(0o600); require('node:fs').appendFileSync(f, '\nthird\n\n'); return { status: 0 }; } });
    expect(seen[0]).toMatch(/^nano -w '.*message\.md'$/); expect(r).toBe('first line\nsecond\nthird'); expect(editInEditor('x', { env: { EDITOR: 'ed' }, run: (c) => { expect(c.startsWith('ed ')).toBe(true); return { status: 0 }; } })).toBe('x'); expect(editInEditor('x', { env: {}, run: (c) => { expect(c.startsWith('vi ')).toBe(true); return { status: 0 }; } })).toBe('x');
  });
  it('really runs an editor command (here sed), with the file name safely quoted', () => {
    expect(editInEditor('hello world', { env: { EDITOR: 'sed -i s/world/there/' } })).toBe('hello there'); expect(editInEditor('keep', { env: { EDITOR: 'true' } })).toBe('keep');
  });
  it('a failing editor changes nothing (undefined), and no temporary file is left behind either way', () => {
    const before = tmpEdits().length; expect(editInEditor('x', { env: { EDITOR: 'false' } })).toBeUndefined(); expect(editInEditor('x', { env: { EDITOR: 'no-such-editor-xyz' } })).toBeUndefined(); expect(editInEditor('x', { run: () => { throw new Error('boom'); } })).toBeUndefined(); expect(editInEditor('ok', { env: { EDITOR: 'true' } })).toBe('ok'); expect(tmpEdits().length).toBe(before);
  });
  it('Windows line endings from an editor become newlines, and an emptied file gives an empty string (you cleared the message)', () => {
    expect(editInEditor('x', { env: { EDITOR: "sh -c 'printf \"a\\r\\nb\\r\\n\" > \"$0\"'" } })).toBe('a\nb'); expect(editInEditor('x', { env: { EDITOR: "sh -c ': > \"$0\"'" } })).toBe('');
    void existsSync;
  });
});
describe('being put in the background', () => {
  it('stops the process and resolves when it is continued', async () => {
    const calls: string[] = []; let cont!: () => void; const proc = { kill: (pid: number, sig: string) => { calls.push(`${pid}:${sig}`); return true; }, once: (_e: string, f: () => void) => { cont = f; return proc; } } as never;
    let resolved = false; const p = stopUntilContinued(proc).then(() => { resolved = true; }); await Promise.resolve(); expect(calls).toEqual(['0:SIGSTOP']); // pid 0: the whole process group expect(resolved).toBe(false); cont(); await p; expect(resolved).toBe(true);
  });
});

describe('is this job the one the terminal is showing', () => {
  const stat = (pgrp: number, tpgid: number) => `1234 (centcom node) S 1000 ${pgrp} 1000 34816 ${tpgid} 4194560 100 0 0 0`;
  it('foreground: the process group is the terminal\'s; background (after bg): it is not; no terminal or no /proc: yes', () => {
    expect(isForeground(() => stat(555, 555))).toBe(true); expect(isForeground(() => stat(555, 777))).toBe(false); expect(isForeground(() => stat(555, -1))).toBe(true); expect(isForeground(() => { throw new Error('no /proc'); })).toBe(true);
    expect(isForeground(() => '1 (a) b) S 1 9 1 1 9 0')).toBe(true); // a ")" in the program name does not confuse it
  });
});
