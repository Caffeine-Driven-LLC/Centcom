import { describe, expect, it } from 'vitest';
import { slashMatches } from '../../src/local/slash.js';

const cmds = [{ name: 'compact', desc: 'a' }, { name: 'commit', desc: 'b' }, { name: 'model', args: '[name]', desc: 'c' }, { name: 'mouse', desc: 'd' }, { name: 'mascot', desc: 'e' }];
describe('slash command menu', () => {
  it('offers names that start with what was typed, without the terminal-only ones', () => {
    expect(slashMatches(cmds, '/').map((c) => c.name)).toEqual(['compact', 'commit', 'model']);
    expect(slashMatches(cmds, '/co').map((c) => c.name)).toEqual(['compact', 'commit']);
    expect(slashMatches(cmds, '/mo').map((c) => c.name)).toEqual(['model']);
  });
  it('is closed for ordinary text, once there is a space, and when the name is complete', () => {
    expect(slashMatches(cmds, 'hello')).toEqual([]); expect(slashMatches(cmds, '/model gpt')).toEqual([]); expect(slashMatches(cmds, '/model')).toEqual([]); expect(slashMatches(cmds, ' /co')).toEqual([]);
  });
});
