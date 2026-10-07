import { describe, expect, it } from 'vitest';
import { QueueMachine } from '../../src/host/queue-machine.js';
import { ClaimLedger, adoptQueue } from '../../src/handoff/index.js';

const ts = '2026-10-07T00:00:00Z';
describe('queue across a transfer (acceptance 3)', () => {
  it('running and held items show as approved to the new host; queued and done stay as they are', () => {
    const q = new QueueMachine(() => 20); for (const id of ['a', 'b', 'c']) { q.apply('queue.submit', 'u', { item: id, size: 1, kind: 'message' }, ts); q.apply('queue.approve', 'h', { item: id }, ts); } q.apply('queue.claim', 'h', { item: 'a', agent_id: 'ag1' }, ts); q.apply('queue.submit', 'u', { item: 'd', size: 1, kind: 'message' }, ts);
    const adopted = adoptQueue(q.view().items as { item: string; state: string }[]); expect(adopted.map((i) => [i.item, i.state])).toEqual([['b', 'approved'], ['c', 'approved'], ['a', 'approved'], ['d', 'queued']].sort((x, y) => adopted.findIndex((i) => i.item === x[0]) - adopted.findIndex((i) => i.item === y[0])));
    expect(adopted.find((i) => i.item === 'a')).toMatchObject({ state: 'approved', agent_id: undefined });
  });
  it('no item runs twice: the ledger refuses a second claim, and so does the queue (a running item is not approved)', () => {
    const l = new ClaimLedger(); expect(l.claim('a', 'ag1')).toBe(true); expect(l.claim('a', 'ag2')).toBe(false); expect(l.holder('a')).toBe('ag1'); l.release('a'); expect(l.claim('a', 'ag2')).toBe(true);
    const q = new QueueMachine(() => 20); q.apply('queue.submit', 'u', { item: 'a', size: 1, kind: 'message' }, ts); q.apply('queue.approve', 'h', { item: 'a' }, ts); q.apply('queue.claim', 'h', { item: 'a', agent_id: 'ag1' }, ts); expect(q.check('queue.claim', 'h', { item: 'a', agent_id: 'ag2' }, { paused: false })).toEqual({ ok: false, code: 'queue_item_gone' });
  });
});
