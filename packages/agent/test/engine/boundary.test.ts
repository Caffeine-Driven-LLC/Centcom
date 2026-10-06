import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const dir = fileURLToPath(new URL('../../src/engine/', import.meta.url));
const files = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(d, e.name)) : e.name.endsWith('.ts') ? [join(d, e.name)] : []));

describe('engine package boundary', () => {
  it('has no vendor SDK and no child_process anywhere', () => {
    const hits = files(dir).flatMap((f) => readFileSync(f, 'utf8').split('\n').map((l, i) => ({ f, i, l })).filter(({ l }) => /@anthropic-ai|from 'openai'|node:child_process|from 'child_process'/.test(l)).map(({ f, i }) => `${f}:${i + 1}`));
    expect(hits).toEqual([]);
  });
  it('the engine folder only imports from its own files, ../types, ../runner types, @centcom/protocol, and node:fs/node:path for the test harness', () => {
    for (const f of files(dir)) for (const m of readFileSync(f, 'utf8').matchAll(/from '([^']+)'/g)) expect(/^(\.\/|\.\.\/types|\.\.\/runner\/types|\.\.\/\.\.\/|@centcom\/protocol|node:fs$|node:path$)/.test(m[1]!), `${f}: ${m[1]}`).toBe(true);
  });
});
