import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const script = resolve(__dirname, 'onboard.sh');
describe('onboarding script', () => {
  it('--check reports what is there and changes nothing', () => {
    const r = spawnSync('sh', [script, '--check'], { encoding: 'utf8' }); expect(r.status).toBe(0); expect(r.stdout).toContain('Centcom onboarding'); expect(r.stdout).toMatch(/ok\s+node v\d+/); expect(r.stdout).toContain('cd your-project && centcom');
  });
  it('says what is missing and stops when a tool is not there', () => {
    const r = spawnSync('/bin/sh', [script, '--check'], { encoding: 'utf8', env: { PATH: '/nonexistent' } }); expect(r.status).toBe(1); expect(r.stdout).toContain('MISSING  Node 22 or newer'); expect(r.stdout).toContain('Install what is missing');
  });
});
