import { randomBytes } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readlinkSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { repo, rig, sh } from './helpers.js';

describe('binary files, large files, symlinks, modes', () => {
  it('binary and 10 MiB files come back byte for byte', async () => {
    const bin = randomBytes(5000); const big = randomBytes(10 * 1024 * 1024); const r = repo({ 'x.bin': bin, 'big.dat': big, '.gitignore': '' }); const t = rig(r);
    const c = await t.turn('one', 1, () => { r.put('x.bin', randomBytes(100)); r.put('big.dat', randomBytes(10 * 1024 * 1024)); });
    await t.mgr.rewind(c.id, 'files', { confirmedPaths: [] }); expect(readFileSync(join(r.dir, 'x.bin')).equals(bin)).toBe(true); expect(readFileSync(join(r.dir, 'big.dat')).equals(big)).toBe(true);
  }, 60_000);
  it('restores content exactly for a file the agent changed', async () => { const bin = randomBytes(70_000); const r = repo({ 'x.bin': bin, '.gitignore': '' }); const t = rig(r); const c = await t.turn('one', 1, () => r.put('x.bin', randomBytes(70_000))); expect(readFileSync(join(r.dir, 'x.bin')).equals(bin)).toBe(false); await t.mgr.rewind(c.id, 'files', { confirmedPaths: ['x.bin'] }); expect(readFileSync(join(r.dir, 'x.bin')).equals(bin)).toBe(true); });
  it('a mode change is restored', async () => { const r = repo({ 'run.sh': '#!/bin/sh\n', '.gitignore': '' }); r.chmod('run.sh', 0o755); sh(r.dir, 'add', '-A'); sh(r.dir, 'commit', '-q', '-m', 'mode'); const t = rig(r); const c = await t.turn('one', 1, () => r.chmod('run.sh', 0o644)); await t.mgr.rewind(c.id, 'files', { confirmedPaths: ['run.sh'] }); expect(statSync(join(r.dir, 'run.sh')).mode & 0o111).not.toBe(0); });
  it('a symlink is restored as a symlink and never followed; a link the agent made is removed, not its target', async () => {
    const outside = repo({ 'secret.txt': 'do not touch\n' }, { git: false }); const r = repo({ 'real.txt': 'r\n', '.gitignore': '' }); r.link('real.txt', 'ln'); sh(r.dir, 'add', '-A'); sh(r.dir, 'commit', '-q', '-m', 'ln'); const t = rig(r);
    const c = await t.turn('one', 1, () => { rmSync(join(r.dir, 'ln')); r.put('ln', 'now a file\n'); r.link(join(outside.dir, 'secret.txt'), 'evil'); });
    await t.mgr.rewind(c.id, 'files', { confirmedPaths: ['ln', 'evil'] }); expect(lstatSync(join(r.dir, 'ln')).isSymbolicLink()).toBe(true); expect(readlinkSync(join(r.dir, 'ln'))).toBe('real.txt'); expect(existsSync(join(r.dir, 'evil'))).toBe(false); expect(readFileSync(join(outside.dir, 'secret.txt'), 'utf8')).toBe('do not touch\n');
  });
  it('refuses to write through a folder that became a symlink to outside the working folder', async () => {
    const outside = repo({}, { git: false }); const r = repo({ 'dir/f.txt': 'orig\n', '.gitignore': '' }); const t = rig(r); const c = await t.turn('one', 1, () => { rmSync(join(r.dir, 'dir'), { recursive: true }); r.link(outside.dir, 'dir'); });
    const res = await t.mgr.rewind(c.id, 'files', { confirmedPaths: ['dir', 'dir/f.txt'] }).catch((e) => e); expect(existsSync(join(outside.dir, 'f.txt'))).toBe(false); void res;
  });
  it('file names with spaces, quotes, unicode and newlines work', async () => { const names = ['with space.txt', 'quo"te.txt', 'ünï.txt', 'new\nline.txt', "it's.txt"]; const r = repo({ '.gitignore': '' }); const t = rig(r); const c = await t.mgr.create('start', { promptSeq: 1 }); for (const n of names) r.put(n, 'x'); await t.mgr.endTurn(); const res = await t.mgr.rewind(c.id, 'files'); expect(res.deleted.sort()).toEqual([...names].sort()); for (const n of names) expect(existsSync(join(r.dir, n))).toBe(false); });
});
