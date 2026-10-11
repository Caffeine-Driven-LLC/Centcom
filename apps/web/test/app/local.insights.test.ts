import { describe, expect, it } from 'vitest';
import type { Item } from '@centcom/tui';
import { compactNumber, duration, insights, money } from '../../src/local/insights.js';

const tool = (o: Partial<Extract<Item, { kind: 'tool' }>>): Item => ({ kind: 'tool', id: o.id ?? 't', toolId: 't', agentId: 'a', name: 'Edit', summary: '', risk: 'low', status: 'ok', startedAt: 0, ...o } as Item);

describe('session insights', () => {
  it('counts steps, commands and failures, and groups edits by file with the lines added and removed', () => {
    const items: Item[] = [
      tool({ id: '1', path: '/p/a.ts', diff: '--- a\n+++ b\n+one\n+two\n-gone' }),
      tool({ id: '2', path: '/p/a.ts', diff: '+three' }),
      tool({ id: '3', name: 'Bash', command: 'ls' }),
      tool({ id: '4', path: '/p/b.ts', status: 'denied' }),
      tool({ id: '5', status: 'running', name: 'Read' }),
    ];
    const r = insights(items, undefined);
    expect(r).toMatchObject({ steps: 5, commands: 1, failed: 1, running: 1, added: 3, removed: 1 });
    expect(r.files).toEqual([{ path: '/p/a.ts', edits: 2, added: 3, removed: 1, failed: false, diff: '--- a\n+++ b\n+one\n+two\n-gone\n+three' }, { path: '/p/b.ts', edits: 1, added: 0, removed: 0, failed: true, diff: '' }]);
  });
  it('lists the other people who wrote in a shared session, once each', () => {
    const u = (id: string, name: string, slot: number): Item => ({ kind: 'user', id, text: 'hi', ts: 0, member: { name, slot } });
    const r = insights([u('1', 'Ada', 1), u('2', 'Ada', 1), u('3', 'Lin', 2), { kind: 'user', id: '4', text: 'mine', ts: 0 }], undefined);
    expect(r.people).toEqual([{ name: 'Ada', slot: 1, messages: 2 }, { name: 'Lin', slot: 2, messages: 1 }]);
  });
  it('reads the plan, the fullest context, tokens, cost and the running time from the state', () => {
    const state = { busy: true, turnStartedAt: 1_000, tasks: [{ id: '1', text: 'a', status: 'completed' }, { id: '2', text: 'b', status: 'in_progress' }, { id: '3', text: 'c', status: 'pending' }], agents: [{ ctxPct: 40, inTok: 100, outTok: 50, cost: 0.5 }, { ctxPct: 72, inTok: 10, outTok: 0, cost: 0.25 }] } as never;
    const r = insights([], state, 66_000);
    expect(r.plan).toEqual({ done: 1, total: 3, current: 'b' }); expect(r.context).toBe(72); expect(r.tokens).toBe(160); expect(r.cost).toBeCloseTo(0.75); expect(r.elapsedS).toBe(65);
  });
  it('formats numbers, money and durations', () => {
    expect([compactNumber(999), compactNumber(1500), compactNumber(2_400_000)]).toEqual(['999', '1.5k', '2.4M']);
    expect([money(0), money(1.234)]).toEqual(['$0.00', '$1.23']); expect([duration(41), duration(125)]).toEqual(['41s', '2m 05s']);
  });
});
