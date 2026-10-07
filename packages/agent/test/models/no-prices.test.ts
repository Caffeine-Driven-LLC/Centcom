import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('no prices, no model API', () => {
  it('the models folder holds no price, per_mtok, fetch( or vendor SDK import', () => {
    const dir = new URL('../../src/models/', import.meta.url);
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.ts'))) expect(readFileSync(new URL(f, dir), 'utf8'), f).not.toMatch(/price|per_mtok|fetch\(|@anthropic-ai|from 'openai'/i);
  });
});
