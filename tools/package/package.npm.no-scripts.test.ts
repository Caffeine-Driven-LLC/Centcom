import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
describe('the npm packages run nothing when they are installed', () => {
  const files = execFileSync('git', ['ls-files', '*package.json'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
  it('finds the package.json files of the repository', () => { expect(files).toContain('package.json'); expect(files).toContain('apps/cli/package.json'); expect(files.length).toBeGreaterThan(8); });
  it('none of them has an install, preinstall or postinstall script (a package that runs code at install time is not acceptable)', () => {
    const bad = files.filter((f) => { const s = (JSON.parse(readFileSync(join(ROOT, f), 'utf8')).scripts ?? {}) as Record<string, string>; return ['install', 'preinstall', 'postinstall', 'prepare'].some((k) => k in s && (k !== 'prepare' || f !== 'package.json')); });
    expect(bad).toEqual([]);
  });
});
