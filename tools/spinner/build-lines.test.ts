import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain JS tool
import { buildLines } from './build-lines.mjs';

const root = new URL('../../', import.meta.url);
describe('spinner lines', () => {
  it('lines.json matches assets/The-Lines.txt: 743 entries, trimmed, no repeats', () => {
    const built: string[] = buildLines(readFileSync(new URL('assets/The-Lines.txt', root), 'utf8')); const committed = JSON.parse(readFileSync(new URL('packages/tui/src/spinner/lines.json', root), 'utf8'));
    expect(committed).toEqual(built); expect(built).toHaveLength(743); expect(new Set(built).size).toBe(743); expect(built.every((l) => l === l.trim() && l.length > 0)).toBe(true);
  });
  it('trims, drops blanks and repeats', () => { expect(buildLines('  a \n\nb\na\n')).toEqual(['a', 'b']); });
});
