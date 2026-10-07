import { describe, expect, it } from 'vitest';
import { rig } from './rig.js';

describe('switching models', () => {
  it('applies at once when idle, with one model.changed', async () => {
    const r = rig(); await r.reg.switchTo('a1', 'm-b', 'user'); expect(r.set).toEqual(['m-b']); expect(r.changed).toEqual([{ agent_id: 'a1', from: null, to: 'm-b', reason: 'user' }]);
  });
  it('during a turn it returns at once and the engine hears of it only after turn.done', async () => {
    const r = rig(); r.reg.onEvent('a1', { type: 'turn.started' }); const c = await r.reg.switchTo('a1', 'm-b', 'user'); expect(c.note).toMatch(/after this turn/); expect(r.set).toEqual([]); expect(r.changed).toHaveLength(0);
    r.reg.onEvent('a1', { type: 'turn.done' }); expect(r.set).toEqual(['m-b']); expect(r.changed).toHaveLength(1); r.reg.onEvent('a1', { type: 'turn.done' }); expect(r.changed).toHaveLength(1);
  });
  it('switching to the current model is a no-op that says so', async () => {
    const r = rig(); await r.reg.switchTo('a1', 'm-b', 'user'); const c = await r.reg.switchTo('a1', 'm-b', 'user'); expect(c.note).toBe('Already using m-b.'); expect(r.changed).toHaveLength(1);
  });
  it('an engine rejection keeps the previous model and shows the tool\'s words verbatim', async () => {
    const r = rig({ config: { model: 'first' } }); await r.reg.switchTo('a1', 'bogus', 'user'); r.reg.onRejected('a1', 'There is no model called bogus.');
    expect(r.reg.resolve('a1').model).toBe('first'); expect(r.set.at(-1)).toBe('first'); expect(r.notes[0]).toEqual({ level: 'warn', text: "Couldn't switch to bogus. Still using first.", detail: 'There is no model called bogus.' });
  });
});
