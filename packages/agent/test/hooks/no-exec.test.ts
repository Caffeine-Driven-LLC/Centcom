import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const dir = join(import.meta.dirname, '../../src/hooks');
describe('acceptance 7: nothing here runs a command', () => {
  const files = readdirSync(dir).filter((f) => f.endsWith('.ts'));
  it('has files to check', () => { expect(files.length).toBeGreaterThan(5); });
  it.each(files)('%s', (f) => { const src = readFileSync(join(dir, f), 'utf8'); expect(src).not.toMatch(/child_process/); expect(src).not.toMatch(/(?<![.\w])(spawn|spawnSync|exec|execSync|execFile|execFileSync|fork)\s*\(/); expect(src).not.toMatch(/\beval\(|new Function\(/); });
});
