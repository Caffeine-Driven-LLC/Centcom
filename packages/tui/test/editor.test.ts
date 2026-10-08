import { describe, expect, it } from 'vitest';
import { backspace, del, insert, killToLineStart, killWordLeft, killWordRight, layoutInput, removeRange, selRange, selectedText, left, lineEnd, lineStart, moveVertical, right, wordLeft, wordRight } from '../src/util/editor.js';

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
    expect(killWordRight(E('one two three', 4))).toEqual({ text: 'one  three', cursor: 4 }); expect(killWordRight(E('one', 3))).toEqual({ text: 'one', cursor: 3 });
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
    expect(layoutInput(E('abcdefgh', 8), 4)).toEqual({ rows: ['abcd', 'efgh'], row: 1, col: 4, starts: [0, 4] });
    expect(layoutInput(E('ab\ncd', 4), 10)).toEqual({ rows: ['ab', 'cd'], row: 1, col: 1, starts: [0, 3] });
    expect(layoutInput(E('', 0), 10)).toEqual({ rows: [''], row: 0, col: 0, starts: [0] });
  });
  it('selection: range between anchor and cursor either way, empty when equal, text and removal', () => {
    expect(selRange('hello world', 5, 0)).toEqual([0, 5]); expect(selRange('hello world', 0, 5)).toEqual([0, 5]); expect(selRange('hi', 1, 1)).toBeUndefined(); expect(selRange('hi', 1, undefined)).toBeUndefined();
    expect(selectedText('hello world', 11, 6)).toBe('world'); expect(removeRange({ text: 'hello world', cursor: 11 }, 5, 11)).toEqual({ text: 'hello', cursor: 5 });
    expect(selRange('hi', 2, 99)).toBeUndefined(); // an anchor past the end is clamped, and equals the cursor
  });
});

describe('@file mentions', () => {
  it('finds the word being typed, only when the @ starts a word', async () => {
    const { mentionAt } = await import('../src/util/editor.js');
    expect(mentionAt('look at @src/ap', 15)).toEqual({ start: 8, end: 15, query: 'src/ap' }); expect(mentionAt('@x', 2)).toEqual({ start: 0, end: 2, query: 'x' }); expect(mentionAt('see @', 5)).toEqual({ start: 4, end: 5, query: '' });
    expect(mentionAt('mail me at a@b.com', 18)).toBeUndefined(); expect(mentionAt('no mention here', 5)).toBeUndefined(); expect(mentionAt('done @file.ts and more', 22)).toBeUndefined(); // the cursor is past the word
    expect(mentionAt('two @a.ts @b', 12)).toEqual({ start: 10, end: 12, query: 'b' }); expect(mentionAt('line one\n@src', 13)).toEqual({ start: 9, end: 13, query: 'src' });
  });
  it('completion replaces the whole word (also the part after the cursor), adds a space, and puts the cursor after it', async () => {
    const { mentionAt, completeMention } = await import('../src/util/editor.js'); const text = 'check @src/a and then'; const m = mentionAt(text, 12)!;
    expect(completeMention({ text, cursor: 12 }, m, 'src/app.ts')).toEqual({ text: 'check @src/app.ts and then', cursor: 18 }); const end = 'check @sr'; expect(completeMention({ text: end, cursor: 9 }, mentionAt(end, 9)!, 'src/x.ts')).toEqual({ text: 'check @src/x.ts ', cursor: 16 });
  });
});
