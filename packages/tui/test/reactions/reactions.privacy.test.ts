import { describe, expect, it, vi } from 'vitest';
import { ReactionController, type OutFrame } from '../../src/reactions/index.js';

describe('privacy (acceptance 5)', () => {
  it('comment text goes only into the encrypted part: p is absent, nothing is logged, 2 001 characters are refused', async () => {
    const sent: OutFrame[] = []; const spy = vi.spyOn(console, 'log'); let t = 0; const ctl = new ReactionController({ self: 'me', clock: { now: () => t, setTimeout: () => 0, clearTimeout: () => undefined }, send: async (f) => { sent.push(f); }, newId: () => 'msg_1' });
    expect(await ctl.comment('msg_T', 'CANARY-5521 looks good')).toEqual({ ok: true }); expect(sent[0]).toMatchObject({ t: 'event', k: 'comment.add', secret: { target: 'msg_T', text: 'CANARY-5521 looks good' } }); expect(sent[0]!.p).toBeUndefined(); expect(JSON.stringify({ ...sent[0], secret: undefined })).not.toContain('CANARY'); expect(spy).not.toHaveBeenCalled(); t += 1000;
    expect(await ctl.comment('msg_T', 'x'.repeat(2001))).toEqual({ ok: false, reason: 'too_long' }); expect(await ctl.comment('msg_T', 'x'.repeat(2000))).toEqual({ ok: true }); expect(await ctl.comment('msg_T', '   ')).toEqual({ ok: false, reason: 'empty' }); expect(sent).toHaveLength(2); spy.mockRestore();
  });
});
