import { describe, expect, it, vi } from 'vitest';
import { REVERT_MS, ReactionAnimator, ReactionController, summarize, type OutFrame } from '../../src/reactions/index.js';

const clock = () => { let t = 0; const q: { at: number; fn: () => void; h: number }[] = []; let id = 0; return { now: () => t, setTimeout: (fn: () => void, ms: number) => { const h = ++id; q.push({ at: t + ms, fn, h }); return h; }, clearTimeout: (h: never) => { const i = q.findIndex((x) => x.h === (h as unknown as number)); if (i >= 0) q.splice(i, 1); }, advance(ms: number) { const end = t + ms; for (;;) { q.sort((a, b) => a.at - b.at); const n = q[0]; if (!n || n.at > end) break; q.shift(); t = n.at; n.fn(); } t = end; } }; };
const make = (o: { canReact?: () => boolean } = {}) => { const c = clock(); const sent: OutFrame[] = []; const toast = vi.fn(); let n = 0; const ctl = new ReactionController({ self: 'me', clock: c, send: async (f) => { sent.push(f); }, newId: () => `msg_${++n}`, toast, ...o }); return { c, sent, toast, ctl }; };
const mine = (ctl: ReactionController, t = 'msg_T') => summarize(ctl.reactions, t, 'me');

describe('toggling (acceptance 1, 2)', () => {
  it('sends exactly one event frame per toggle, add then remove, and shows it at once', () => {
    const { ctl, sent } = make(); expect(ctl.toggle('msg_T', 'thumbs')).toBe('sent'); expect(sent).toHaveLength(1); expect(sent[0]).toMatchObject({ t: 'event', k: 'reaction', p: { target: 'msg_T', code: 'thumbs', op: 'add' } }); expect(mine(ctl)).toEqual([{ code: 'thumbs', count: 1, mine: true }]);
    ctl.onFrame({ k: 'reaction', id: sent[0]!.id, seq: 5, from: 'me', p: sent[0]!.p }); expect(mine(ctl)[0]!.count).toBe(1); ctl.toggle('msg_T', 'thumbs'); expect(sent[1]).toMatchObject({ p: { op: 'remove' } }); expect(mine(ctl)).toEqual([]);
  });
  it('reverts after 5 s without an echo; an echo in time keeps it', () => {
    const { ctl, c, sent } = make(); ctl.toggle('msg_T', 'heart'); c.advance(REVERT_MS - 1); expect(mine(ctl)).toHaveLength(1); c.advance(1); expect(mine(ctl)).toEqual([]);
    ctl.toggle('msg_T', 'party'); ctl.onFrame({ k: 'reaction', id: sent.at(-1)!.id, seq: 9, from: 'me', p: sent.at(-1)!.p }); c.advance(10_000); expect(mine(ctl)).toEqual([{ code: 'party', count: 1, mine: true }]);
  });
  it('a send that fails takes the guess back at once', async () => { const c = clock(); const ctl = new ReactionController({ self: 'me', clock: c, send: () => Promise.reject(new Error('down')), newId: () => 'msg_1' }); ctl.toggle('t', 'eyes'); await Promise.resolve(); await Promise.resolve(); expect(summarize(ctl.reactions, 't', 'me')).toEqual([]); });
  it('a fourth distinct reaction on one message is blocked with a toast and sends nothing; your own can still be removed', () => {
    const { ctl, sent, toast } = make(); for (const code of ['thumbs', 'heart', 'party']) ctl.toggle('msg_T', code); expect(ctl.toggle('msg_T', 'laugh')).toBe('limit'); expect(sent).toHaveLength(3); expect(toast).toHaveBeenCalledWith(expect.objectContaining({ level: 'warn' })); expect(ctl.toggle('msg_T', 'party')).toBe('sent'); expect(ctl.toggle('msg_T', 'laugh')).toBe('sent'); expect(ctl.toggle('msg_U', 'laugh')).toBe('sent');
  });
  it('a muted member cannot toggle; spam is dropped by the bucket (20, refilling 30 a second), never queued', () => {
    let on = false; const m = make({ canReact: () => on }); expect(m.ctl.toggle('t', 'thumbs')).toBe('disabled'); expect(m.sent).toHaveLength(0); on = true;
    const results = Array.from({ length: 60 }, (_, i) => m.ctl.toggle(`msg_${i}`, 'thumbs')); expect(results.filter((r) => r === 'sent')).toHaveLength(20); expect(results.filter((r) => r === 'rate')).toHaveLength(40); m.c.advance(1000); expect(m.ctl.toggle('msg_x', 'heart')).toBe('sent');
  });
});
describe('animation (acceptance 7)', () => {
  it('once per received reaction, at most 3 at a time, a glyph under reduced motion and for codes without one', () => {
    const c = clock(); const a = new ReactionAnimator(c); expect(a.request('f1', 'reaction_heart')).toEqual({ kind: 'animation', name: 'reaction_heart' }); expect(a.request('f1', 'reaction_heart')).toBeNull(); a.request('f2', 'reaction_party'); a.request('f3', 'reaction_laugh'); expect(a.request('f4', 'reaction_thumbs')).toEqual({ kind: 'glyph' }); c.advance(1600); expect(a.request('f5', 'reaction_thumbs')).toMatchObject({ kind: 'animation' });
    expect(new ReactionAnimator(c, { reducedMotion: () => true }).request('g', 'reaction_heart')).toEqual({ kind: 'glyph' }); expect(new ReactionAnimator(c).request('h', undefined)).toEqual({ kind: 'glyph' });
  });
});
