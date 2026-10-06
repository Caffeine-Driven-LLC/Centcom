import { describe, expect, it } from 'vitest';
import { backspace, del, insert, killToLineStart, killWordLeft, layoutInput, left, lineEnd, lineStart, moveVertical, right, wordLeft, wordRight } from '../src/util/editor.js';

const E = (text: string, cursor = text.length) => ({ text, cursor });
describe('editor', () => {
  it('inserts, deletes and moves by character', () => {
    expect(insert(E('ac', 1), 'b')).toEqual({ text: 'abc', cursor: 2 });
    expect(backspace(E('abc', 2))).toEqual({ text: 'ac', cursor: 1 });
    expect(backspace(E('abc', 0))).toEqual({ text: 'abc', cursor: 0 });
    expect(del(E('abc', 1))).toEqual({ text: 'ac', cursor: 1 });
    expect(left(E('abc', 2)).cursor).toBe(1); expect(right(E('abc', 3)).cursor).toBe(3);
  });
  it('treats emoji as one character', () => {
    expect(backspace(E('a😀', 3))).toEqual({ text: 'a', cursor: 1 });
    expect(right(E('😀b', 0)).cursor).toBe(2);
  });
  it('moves and kills by word and line', () => {
    expect(wordLeft(E('one two three')).cursor).toBe(8); expect(wordRight(E('one two', 0)).cursor).toBe(3);
    expect(killWordLeft(E('one two'))).toEqual({ text: 'one ', cursor: 4 });
    const e = E('first\nsecond', 9);
    expect(lineStart(e).cursor).toBe(6); expect(lineEnd(E('first\nsecond', 2)).cursor).toBe(5);
    expect(killToLineStart(e)).toEqual({ text: 'first\nond', cursor: 6 });
  });
  it('moves between lines keeping the column and stops at the edges', () => {
    expect(moveVertical(E('abcd\nxy', 6), -1)).toEqual({ text: 'abcd\nxy', cursor: 1 });
    expect(moveVertical(E('abcd\nxy', 3), 1)).toEqual({ text: 'abcd\nxy', cursor: 7 });
    expect(moveVertical(E('one line', 2), -1)).toBeNull();
  });
  it('lays out wrapped rows and finds the cursor', () => {
    expect(layoutInput(E('abcdefgh', 8), 4)).toEqual({ rows: ['abcd', 'efgh'], row: 1, col: 4 });
    expect(layoutInput(E('ab\ncd', 4), 10)).toEqual({ rows: ['ab', 'cd'], row: 1, col: 1 });
    expect(layoutInput(E('', 0), 10)).toEqual({ rows: [''], row: 0, col: 0 });
  });
});
