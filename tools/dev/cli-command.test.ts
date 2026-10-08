import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, utimesSync, writeFileSync } from 'node:fs';
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

describe('the launcher: bundle, rebuild and fallback (a fake project root)', () => {
  const fakeRoot = (bundler: string) => {
    const r = mkdtempSync(join(tmpdir(), 'cc-fake-')); const w = (p: string, t: string, mode?: number) => { mkdirSync(join(r, p, '..'), { recursive: true }); writeFileSync(join(r, p), t, { mode }); };
    w('bin/centcom', readFileSync(join(root, 'bin/centcom'), 'utf8'), 0o755); w('node_modules/.bin/tsx', '#!/bin/sh\necho "FALLBACK tsx $*"\n', 0o755); w('tools/dev/bundle-cli.mjs', bundler); w('apps/cli/src/main.tsx', '// app\n'); w('packages/a/src/index.ts', 'export {};\n'); w('pnpm-lock.yaml', 'lock\n');
    return { r, run: (env: Record<string, string> = {}) => execFileSync(join(r, 'bin/centcom'), ['--flag', 'x'], { encoding: 'utf8', env: { ...process.env, ...env } }).trim(), /** Make `p` newer than the built bundle: the bundle goes back a minute, the file back twenty seconds. */ touch: (p: string) => { const b = join(r, 'node_modules/.cache/centcom/cli.mjs'); const old = new Date(Date.now() - 60_000); if (existsSync(b)) utimesSync(b, old, old); const t = new Date(Date.now() - 20_000); utimesSync(join(r, p), t, t); } };
  };
  const BUNDLER = `import { appendFileSync, writeFileSync } from 'node:fs'; appendFileSync(process.env.BUILD_LOG ?? '/dev/null', 'build\\n'); writeFileSync(process.argv[2], "console.log('BUNDLED', process.argv.slice(2).join(' '), process.env.NODE_ENV);");`;
  it('runs the cached bundle with production React and passes the arguments through', () => { const f = fakeRoot(BUNDLER); expect(f.run()).toBe('BUNDLED --flag x production'); });
  it('builds once, reuses the bundle, and rebuilds when a source file, the lockfile or the build script is newer', () => {
    const log = join(mkdtempSync(join(tmpdir(), 'cc-log-')), 'builds'); const f = fakeRoot(BUNDLER); const env = { BUILD_LOG: log }; const builds = () => (existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean).length : 0);
    f.run(env); f.run(env); f.run(env); expect(builds()).toBe(1);
    f.touch('packages/a/src/index.ts'); f.run(env); expect(builds()).toBe(2); f.run(env); expect(builds()).toBe(2);
    f.touch('pnpm-lock.yaml'); f.run(env); expect(builds()).toBe(3); f.touch('tools/dev/bundle-cli.mjs'); f.run(env); expect(builds()).toBe(4);
  });
  it('falls back to running the sources with tsx when the bundle cannot be built, and leaves no half-written file behind', () => {
    const f = fakeRoot(`import { writeFileSync } from 'node:fs'; writeFileSync(process.argv[2], 'partial'); process.exit(1);`);
    expect(f.run()).toBe('FALLBACK tsx ' + join(f.r, 'apps/cli/src/main.tsx') + ' --flag x'); expect(readdirSync(join(f.r, 'node_modules/.cache/centcom')).filter((n) => n.endsWith('.tmp') || n === 'cli.mjs')).toEqual([]);
  });
  it('CENTCOM_DEV=1 skips the bundle and runs the sources', () => { const f = fakeRoot(BUNDLER); expect(f.run({ CENTCOM_DEV: '1' })).toContain('FALLBACK tsx'); expect(existsSync(join(f.r, 'node_modules/.cache/centcom/cli.mjs'))).toBe(false); });
});
