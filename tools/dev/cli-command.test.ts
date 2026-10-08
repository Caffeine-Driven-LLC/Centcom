import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdtempSync, readlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../..');
describe('the centcom command', () => {
  it('install-cli links bin/centcom into a folder, refuses to overwrite a real file, and uninstalls', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cc-bin-')); const out = execFileSync('sh', [join(root, 'tools/dev/install-cli.sh'), dir], { encoding: 'utf8', env: { ...process.env, PATH: process.env.PATH } });
    expect(out).toContain('linked'); expect(lstatSync(join(dir, 'centcom')).isSymbolicLink()).toBe(true); expect(readlinkSync(join(dir, 'centcom'))).toBe(join(root, 'bin/centcom'));
    execFileSync('sh', [join(root, 'tools/dev/install-cli.sh'), dir]); // twice is fine
    execFileSync('sh', [join(root, 'tools/dev/install-cli.sh'), '--uninstall', dir]); expect(existsSync(join(dir, 'centcom'))).toBe(false);
    const dir2 = mkdtempSync(join(tmpdir(), 'cc-bin2-')); execFileSync('sh', ['-c', `echo x > ${join(dir2, 'centcom')}`]); expect(() => execFileSync('sh', [join(root, 'tools/dev/install-cli.sh'), dir2], { stdio: 'pipe' })).toThrow();
  });
  it('runs from any folder through the link and reports its version and help', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cc-bin3-')); execFileSync('sh', [join(root, 'tools/dev/install-cli.sh'), dir]); const cwd = mkdtempSync(join(tmpdir(), 'cc-any-'));
    expect(execFileSync(join(dir, 'centcom'), ['--version'], { cwd, encoding: 'utf8' }).trim()).toMatch(/^\d+\.\d+\.\d+$/);
    expect(execFileSync(join(dir, 'centcom'), ['--help'], { cwd, encoding: 'utf8' })).toContain('start the terminal app in this directory');
  }, 30_000);
});
