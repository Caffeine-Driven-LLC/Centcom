import { describe, expect, it } from 'vitest';
import { captureTurns, flagValues, prefixChanges } from '../../src/index.js';

describe('what Centcom launches claude with', () => {
  it('reads the values of a flag, one or several', () => {
    const a = ['-p', '--add-dir', '/a', '--add-dir', '/b', '--allowedTools', 'Read', 'Bash', '--model', 'sonnet'];
    expect(flagValues(a, '--add-dir')).toEqual(['/a', '/b']); expect(flagValues(a, '--allowedTools')).toEqual(['Read', 'Bash']); expect(flagValues(a, '--model')).toEqual(['sonnet']); expect(flagValues(a, '--effort')).toEqual([]);
  });
  it('reports a prefix flag that differs between turns, and not --resume', () => {
    expect(prefixChanges([['--resume', 'a', '--model', 'x'], ['--resume', 'b', '--model', 'x']])).toEqual([]);
    expect(prefixChanges([['--append-system-prompt', 'one'], ['--append-system-prompt', 'two']])).toEqual([{ flag: '--append-system-prompt', turn: 1, before: ['one'], after: ['two'] }]);
  });
  it('drives the real engine over three turns against a stand-in and keeps the cached prefix identical', async () => {
    const gate = { decide: async () => ({ decision: 'deny' as const, scope: 'once' as const }) };
    const cap = await captureTurns(['one', 'two', 'three'], { approvalGate: gate, addDirs: ['/x'], systemPromptAppend: 'Stable text.' });
    expect(cap.argv).toHaveLength(3); expect(cap.argv[0]).not.toContain('--resume'); expect(cap.argv[1]).toContain('--resume');
    expect(prefixChanges(cap.argv)).toEqual([]);
    expect(cap.events.filter((e) => e.type === 'turn.done')).toHaveLength(3);
  });
});
