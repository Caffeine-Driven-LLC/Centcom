import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { scanObject, setMember } from '../../src/hooks/jsonpatch.js';

// -0 has no JSON form, so the values are normalised through JSON first
const json = fc.jsonValue({ maxDepth: 3 }).filter((v) => v !== null && typeof v === 'object' && !Array.isArray(v)).map((v) => JSON.parse(JSON.stringify(v)) as Record<string, unknown>);
describe('byte-preserving patch', () => {
  it('replaces one member and leaves the text around it unchanged, for any formatting', () => {
    fc.assert(fc.property(json, fc.constantFrom(0, 2, 4, '\t'), fc.boolean(), (obj, indent, crlf) => {
      let text = JSON.stringify({ ...obj, hooks: { old: 1 } }, null, indent as never); if (crlf) text = text.replace(/\n/g, '\r\n');
      const next = setMember(text, 0, 'hooks', { Stop: [1] })!; const a = scanObject(text, 0)!.members.find((m) => m.key === 'hooks')!; expect(next.startsWith(text.slice(0, a.valStart))).toBe(true); expect(next.endsWith(text.slice(a.valEnd))).toBe(true); expect(JSON.parse(next)).toEqual({ ...obj, hooks: { Stop: [1] } });
    }), { numRuns: 300 });
  });
  it('inserts and removes members, keeping the others', () => { fc.assert(fc.property(json, fc.constantFrom(0, 2, '\t'), (obj, indent) => { const base = { ...obj }; delete base.zz; const text = JSON.stringify(base, null, indent as never); const added = setMember(text, 0, 'zz', { a: [1, 2] })!; expect(JSON.parse(added)).toEqual({ ...base, zz: { a: [1, 2] } }); const back = setMember(added, 0, 'zz', undefined)!; expect(JSON.parse(back)).toEqual(base); }), { numRuns: 300 }); });
  it('returns undefined for text that is not an object, and never throws on garbage', () => { expect(setMember('[1]', 0, 'a', 1)).toBeUndefined(); expect(setMember('{"a":', 0, 'a', 1)).toBeUndefined(); fc.assert(fc.property(fc.string(), (s) => { expect(() => scanObject(s, 0)).not.toThrow(); }), { numRuns: 500 }); });
  it('strings that contain braces, quotes and escaped characters are skipped correctly', () => { const text = '{"a":"}{\\"x","hooks":{"k":"v"},"b":[{"c":"}"}]}'; const next = setMember(text, 0, 'hooks', { n: 1 })!; expect(JSON.parse(next)).toEqual({ a: '}{"x', hooks: { n: 1 }, b: [{ c: '}' }] }); });
});
