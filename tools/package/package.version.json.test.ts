import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
describe('centcom --version --json', () => {
  it('prints one JSON line with the version, contract, platform, arch, node and channel; plain --version is just the number', () => {
    const run = (...a: string[]) => spawnSync(join(ROOT, 'node_modules/.bin/tsx'), ['apps/cli/src/main.tsx', ...a], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, CENTCOM_NO_UPDATE_CHECK: '1', HOME: '/tmp/cc-version-home' } });
    const j = run('--version', '--json'); expect(j.status).toBe(0); const o = JSON.parse(j.stdout.trim()) as Record<string, string>; expect(Object.keys(o).sort()).toEqual(['arch', 'channel', 'contract', 'node', 'platform', 'version']);
    expect(o.version).toMatch(/^\d+\.\d+\.\d+/); expect(o.contract).toMatch(/^\d+\.\d+\.\d+/); expect(o.platform).toBe(process.platform); expect(o.arch).toBe(process.arch); expect(o.node).toBe(process.version); expect(o.channel).toBe('stable');
    expect(run('--version').stdout.trim()).toBe(o.version);
  }, 60_000);
});
