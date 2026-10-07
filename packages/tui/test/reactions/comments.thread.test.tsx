import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { expectScreen, renderInk } from '../../../testkit/src/index.js';
import { CommentThread, MUTED_REASON, ReactionBar, TOO_LONG } from '../../src/reactions/index.js';

const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms)); const comments = [{ id: 'a', member: 'm1', text: 'looks good', seq: 1, ts: '' }, { id: 'b', member: 'm2', text: 'ship it', seq: 2, ts: '' }];
const name = (m: string) => (m === 'm1' ? 'Ada' : 'Ben');
describe('thread', () => {
  it('shows the comments with names and the composer', async () => { const r = await renderInk(<CommentThread target="t" comments={comments} canComment onAdd={async () => undefined} nameOf={name} />); expect(r.screen()).toEqual(['Ada: looks good', 'Ben: ship it', '> comment…']); r.unmount(); });
  it('typing then Enter calls onAdd once with the text and clears; backspace edits', async () => {
    const onAdd = vi.fn(async () => undefined); const r = await renderInk(<CommentThread target="t" comments={[]} canComment onAdd={onAdd} />); r.stdin.write('hix'); await tick(); r.stdin.write('\x7f'); await tick(); expect(r.screen()[0]).toBe('> hi'); r.stdin.write('\r'); await tick(40); expect(onAdd).toHaveBeenCalledTimes(1); expect(onAdd).toHaveBeenCalledWith('hi'); expect(r.screen()[0]).toBe('> comment…'); r.unmount();
  });
  it('input past 2 000 characters is refused inline with the helper text', async () => { const r = await renderInk(<CommentThread target="t" comments={[]} canComment onAdd={async () => undefined} />, { cols: 120 }); r.stdin.write('a'.repeat(2000)); await tick(40); r.stdin.write('b'); await tick(40); expect(r.screen().join('\n')).toContain(TOO_LONG); expect(r.screen().join('\n')).not.toContain('b'.repeat(1)); r.unmount(); });
  it('muted or without permission: the composer is replaced by the reason, and typing does nothing', async () => { const onAdd = vi.fn(); const r = await renderInk(<CommentThread target="t" comments={comments} canComment={false} disabledReason={MUTED_REASON} onAdd={onAdd} nameOf={name} />); r.stdin.write('hi\r'); await tick(); expect(r.screen().at(-1)).toBe('Muted by host'); expect(onAdd).not.toHaveBeenCalled(); r.unmount(); });
});
describe('bar (acceptance 4, 6; snapshots)', () => {
  const reactions = [{ code: 'thumbs', count: 2, mine: true }, { code: 'heart', count: 1, mine: false }, { code: 'rocket', count: 3, mine: false }];
  it('80 columns: glyph plus count for each code, the picker for people who can react, viewers included', async () => { const r = await renderInk(<ReactionBar target="t" reactions={reactions} selfMember="m" canReact onToggle={() => undefined} />, { cols: 80, colorTier: 'none' }); const s = r.screen(); expect(s[0]).toBe('+1 2  <3 1  • 3'); expect(s[1]).toBe('1 +1  2 <3  3 *  4 :D  5 oo  6 ✓'); expectScreen(s).toMatchSnapshot(); r.unmount(); });
  it('muted: the picker is off and says why; the counts stay', async () => { const r = await renderInk(<ReactionBar target="t" reactions={reactions} selfMember="m" canReact={false} disabledReason={MUTED_REASON} onToggle={() => undefined} />, { cols: 80 }); expect(r.screen()).toEqual(['+1 2  <3 1  • 3', 'Muted by host']); r.unmount(); });
  it('keys 1 to 6 toggle the matching code only when active and allowed', async () => {
    const f = vi.fn(); const r = await renderInk(<ReactionBar target="t" reactions={[]} selfMember="m" canReact onToggle={f} active />); r.stdin.write('2'); r.stdin.write('9'); await tick(); expect(f.mock.calls).toEqual([['heart']]); r.unmount(); const g = vi.fn(); const q = await renderInk(<ReactionBar target="t" reactions={[]} selfMember="m" canReact={false} onToggle={g} active />); q.stdin.write('1'); await tick(); expect(g).not.toHaveBeenCalled(); q.unmount();
  });
});
