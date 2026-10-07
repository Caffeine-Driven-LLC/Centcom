import { expect, it } from 'vitest';
import { used } from '../src/a.js';
import * as all from '../src/a.js';
it('covers only one function', () => { expect(used(-2)).toBe(2); if (process.env.COVER_ALL) { expect(all.unused1(11)).toBe(1); expect(all.unused1(6)).toBe(2); expect(all.unused1(1)).toBe(3); expect(all.unused2('a')).toBe('Aa'); expect(all.unused3(' a ')).toBe('a'); expect(used(3)).toBe(3); } });
