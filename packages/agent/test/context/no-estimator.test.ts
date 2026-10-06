import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const dir = join(import.meta.dirname, '../../src/context');
describe('acceptance 8: nothing counts or estimates tokens', () => {
  const files = readdirSync(dir).filter((f) => f.endsWith('.ts'));
  it.each(files)('%s', (f) => { const src = readFileSync(join(dir, f), 'utf8'); expect(src).not.toMatch(/tiktoken|gpt-?tokenizer|js-tiktoken|@anthropic-ai\/tokenizer/i); expect(src).not.toMatch(/Math\.ceil\([^)]*(length|\.len)[^)]*\/\s*\d/); expect(src).not.toMatch(/\.length\s*\/\s*[34]\b/); expect(src).not.toMatch(/\b(200_?000|128_?000)\b/); });
});
