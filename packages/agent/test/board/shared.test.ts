import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createBoard, type Author } from '../../src/index.js';

const person: Author = { kind: 'person', id: 'you', name: 'you' };
const ana: Author = { kind: 'person', id: 'mem_ana', name: 'Ana', role: 'host' };
function rig() { const clock = { t: 1_800_000_000_000 }; const board = createBoard({ file: join(mkdtempSync(join(tmpdir(), 'cc-board-s-')), 'board.jsonl'), now: () => clock.t }); return { board, clock }; }

describe('notes that come from other people of a session', () => {
  it('keep the id and time of their frame, say who wrote them, and are not posted twice', () => {
    const { board, clock } = rig(); const seen: string[] = []; board.subscribe((c) => seen.push(`${c.op}:${c.remote}`));
    const e = board.post({ author: ana, type: 'decision', text: 'Use pnpm', remote: { id: 'msg_1', ts: clock.t - 1000 } })!;
    expect(e).toMatchObject({ id: 'msg_1', ts: clock.t - 1000, shared: true, author: { name: 'Ana', role: 'host' } });
    expect(board.post({ author: ana, type: 'decision', text: 'Use pnpm', remote: { id: 'msg_1' } })).toEqual(e);
    board.pin('msg_1', true, { remote: true }); board.retract('msg_1', { remote: true });
    expect(board.list()).toEqual([]); expect(seen).toEqual(['post:true', 'pin:true', 'retract:true']);
  });
  it('tell the listener about local changes as local, and a listener that throws does not break the board', () => {
    const { board } = rig(); const seen: string[] = []; board.subscribe(() => { throw new Error('x'); }); const off = board.subscribe((c) => seen.push(`${c.op}:${c.remote}`));
    const e = board.post({ author: person, type: 'finding', text: 'a' })!; board.pin(e.id, true); board.retract(e.id); off(); board.post({ author: person, type: 'finding', text: 'b' });
    expect(seen).toEqual(['post:false', 'pin:false', 'retract:false']);
  });
  it('a pinned note is in every agent digest, even when the budget is spent, with its author and role', () => {
    const { board } = rig(); for (let i = 0; i < 5; i++) board.post({ author: person, type: 'warning', text: `warning ${i} about something that takes up room in the digest` }); board.post({ author: ana, type: 'decision', text: 'Never edit db/migrate', remote: { id: 'msg_2' } }); board.pin('msg_2', true);
    for (const id of ['a1', 'a2']) { const d = board.digest({ id, name: id }, { budgetTokens: 60 })!; expect(d.lines[0]).toContain('Never edit db/migrate'); expect(d.lines[0]).toContain('Ana (host)'); }
    expect(board.digest({ id: 'a1', name: 'a1' }, { budgetTokens: 60 })).toBeUndefined(); // an agent is told once
  });
});
