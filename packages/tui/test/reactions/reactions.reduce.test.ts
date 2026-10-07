import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { emptyComments, emptyReactions, reduceComments, reduceReactions, summarize, type DecodedFrame } from '../../src/reactions/index.js';

let n = 0; const fr = (from: string, op: 'add' | 'remove', code: string, seq: number, target = 'msg_T', id?: string): DecodedFrame => ({ k: 'reaction', id: id ?? `msg_${++n}`, seq, from, p: { target, code, op } });
const fold = (list: DecodedFrame[]) => list.reduce(reduceReactions, emptyReactions());
describe('reduce (acceptance 3, 6)', () => {
  it('two members adding the same reaction count 2; replaying a frame id does not count twice; a remove takes yours away', () => {
    const a = fr('m1', 'add', 'thumbs', 1); let s = fold([a, fr('m2', 'add', 'thumbs', 2), a, { ...a }]); expect(summarize(s, 'msg_T', 'm1')).toEqual([{ code: 'thumbs', count: 2, mine: true }]); s = reduceReactions(s, fr('m1', 'remove', 'thumbs', 3)); expect(summarize(s, 'msg_T', 'm1')).toEqual([{ code: 'thumbs', count: 1, mine: false }]);
  });
  it('the same member adding twice with different frame ids is still one', () => { expect(summarize(fold([fr('m1', 'add', 'heart', 1), fr('m1', 'add', 'heart', 2)]), 'msg_T', 'm1')).toEqual([{ code: 'heart', count: 1, mine: true }]); });
  it('an unknown code from a newer client is kept with its count, after the known ones', () => {
    const s = fold([fr('m1', 'add', 'rocket', 1), fr('m2', 'add', 'rocket', 2), fr('m1', 'add', 'check', 3)]); expect(summarize(s, 'msg_T', 'm1').map((r) => [r.code, r.count])).toEqual([['check', 1], ['rocket', 2]]);
  });
  it('junk never throws and changes nothing', () => { const s = emptyReactions(); for (const bad of [{ k: 'reaction', p: {} }, { k: 'reaction', from: 'm', p: { target: 't', code: 'c', op: 'toggle' } }, { k: 'other' }, {}, null as never]) expect(() => reduceReactions(s, bad)).not.toThrow(); expect(reduceReactions(s, { k: 'reaction', p: {} })).toBe(s); });
  it('any order and any duplication gives the same result (property)', () => {
    const base: DecodedFrame[] = []; let seq = 0; for (const m of ['m1', 'm2', 'm3']) for (const c of ['thumbs', 'heart']) { base.push(fr(m, 'add', c, ++seq), fr(m, 'remove', c, ++seq), fr(m, 'add', c, ++seq)); } const want = JSON.stringify(summarize(fold(base), 'msg_T', 'm1'));
    fc.assert(fc.property(fc.shuffledSubarray(base, { minLength: base.length, maxLength: base.length }), fc.array(fc.nat(base.length - 1), { maxLength: 8 }), (shuf, dups) => { expect(JSON.stringify(summarize(fold([...shuf, ...dups.map((i) => base[i]!)]), 'msg_T', 'm1'))).toBe(want); }), { numRuns: 80 });
  });
});
describe('comments', () => {
  it('come from the decrypted part only, in seq order, once per frame id', () => {
    const c = (id: string, seq: number, text?: string): DecodedFrame => ({ k: 'comment.add', id, seq, from: 'm1', ts: 't', secret: { target: 'msg_T', text }, p: { text: 'LEAK' } }); let s = emptyComments(); for (const f of [c('a', 2, 'second'), c('b', 1, 'first'), c('a', 2, 'second'), c('c', 3, undefined)]) s = reduceComments(s, f);
    expect(s.byTarget.msg_T!.map((x) => x.text)).toEqual(['first', 'second']); expect(JSON.stringify(s)).not.toContain('LEAK');
  });
});
