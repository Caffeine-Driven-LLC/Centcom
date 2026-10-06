import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../../../', import.meta.url)); const fixture = fileURLToPath(new URL('./__coverage_fixture__/', import.meta.url));
const run = (env: Record<string, string>) => spawnSync(join(root, 'node_modules/.bin/vitest'), ['run', '--coverage', '--root', fixture, '--config', join(fixture, 'vitest.config.ts')], { cwd: fixture, encoding: 'utf8', env: { ...process.env, COVERAGE_OUT: mkdtempSync(join(tmpdir(), 'cc-cov-')), ...env } });
describe('coverage floor (acceptance 6)', () => {
  it('fails with exit code 1 when lines coverage is below 80 %, and passes when everything is covered', () => {
    const low = run({}); expect(low.status).toBe(1); expect(low.stdout + low.stderr).toMatch(/threshold|coverage/i);
    const full = run({ COVER_ALL: '1' }); expect(full.status, full.stdout + full.stderr).toBe(0);
  }, 120_000);
});
