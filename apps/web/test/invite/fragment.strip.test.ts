// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { KeyHolder, decodeB64u, takeFragmentKey } from '../../shell/src/invite/fragment.js';

const K = 'AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA'; /* 32 bytes, base64url */
describe('the key fragment (acceptance 1)', () => {
  it('is read into memory and gone from the address in the same step', () => { window.history.replaceState(null, '', `/j/TOKEN#k=${K}`); expect(window.location.hash).toBe(`#k=${K}`); const h = takeFragmentKey(window.location, window.history); expect(window.location.hash).toBe(''); expect(window.location.pathname).toBe('/j/TOKEN'); expect(h.present).toBe(true); h.use((b) => expect([...b.slice(0, 4)]).toEqual([1, 2, 3, 4])); expect(decodeB64u(K)).toHaveLength(32); });
  it('keeps the path and the query and drops only the fragment', () => { window.history.replaceState(null, '', `/j/TOKEN?x=1#k=${K}`); takeFragmentKey(window.location, window.history); expect(window.location.search).toBe('?x=1'); expect(window.location.hash).toBe(''); });
  it('a missing, short or odd key leaves nothing in memory, and the address is still cleaned', () => { for (const frag of ['', '#', '#k=', '#k=short', '#k=' + 'a'.repeat(200), '#k=has space!!!!!!!!', '#other=1']) { window.history.replaceState(null, '', `/j/T${frag}`); const h = takeFragmentKey(window.location, window.history); expect(h.present, frag).toBe(false); expect(window.location.hash, frag).toBe(''); } });
  it('zero overwrites the bytes and the holder refuses further use', () => { window.history.replaceState(null, '', `/j/T#k=${K}`); const h = takeFragmentKey(window.location, window.history); let seen: Uint8Array | undefined; h.use((b) => { seen = b; }); h.zero(); expect([...seen!].every((x) => x === 0)).toBe(true); expect(h.present).toBe(false); expect(() => h.use(() => 1)).toThrow(); new KeyHolder().zero(); });
});
