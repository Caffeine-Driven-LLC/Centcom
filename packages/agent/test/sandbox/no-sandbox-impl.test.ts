import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const dir = join(import.meta.dirname, '../../src/sandbox');
describe('acceptance 9: no sandbox of our own', () => {
  const files = readdirSync(dir).filter((f) => f.endsWith('.ts'));
  it('has source files to check', () => { expect(files.length).toBeGreaterThan(4); });
  it.each(files)('%s runs no process and wraps no sandbox', (f) => { const src = readFileSync(join(dir, f), 'utf8'); expect(src).not.toMatch(/\b(bwrap|bubblewrap|sandbox-exec|firejail|seccomp|landlock|nsjail|unshare)\b.*(spawn|exec|run)|spawn\w*\(\s*['"`](bwrap|sandbox-exec|firejail)/); expect(src).not.toMatch(/from ['"]node:child_process['"]|require\(['"]child_process/); expect(src).not.toMatch(/from ['"]@(anthropic-ai|openai)\//); expect(src).not.toMatch(/\bnew Function\(|\beval\(/); });
});
