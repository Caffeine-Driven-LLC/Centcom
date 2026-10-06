import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('--help', () => {
  it('names the reduced-motion variable that the docs and the config loader use, and mentions the older spelling', () => {
    const main = fileURLToPath(new URL('../src/main.tsx', import.meta.url));
    const out = execFileSync(process.execPath, ['--import', 'tsx', main, '--help'], { encoding: 'utf8' });
    expect(out).toContain('CENTCOM_REDUCED_MOTION'); expect(out).toContain('CENTCOM_REDUCE_MOTION'); expect(out).toMatch(/--no-save\s+do not save this conversation or your prompt history/);
  });
});
