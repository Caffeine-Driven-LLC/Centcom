import { describe, expect, it } from 'vitest';
import { createModelRegistry } from '../../src/index.js';
import { rig } from './rig.js';

describe('model choice order', () => {
  it('flag beats override beats project config beats user config; nothing set gives null', async () => {
    const r = rig({ config: { model: 'user-m', projectModel: 'proj-m' } }); r.reg.attach({ agentId: 'f', engine: 'claude-code', setModel: () => undefined, flag: 'flag-m' });
    expect(r.reg.resolve('f').model).toBe('flag-m'); expect(r.reg.resolve('a1').model).toBe('proj-m');
    const userOnly = rig({ config: { model: 'user-m' } }); expect(userOnly.reg.resolve('a1').model).toBe('user-m');
    const none = rig(); expect(none.reg.resolve('a1')).toEqual({ engine: 'claude-code', model: null, passAs: 'flag' }); expect(none.reg.current('a1').source).toBe('engine-reported');
    await r.reg.switchTo('a1', 'over-m', 'user'); expect(r.reg.resolve('a1').model).toBe('over-m'); expect(r.reg.resolve('f').model).toBe('flag-m');
  });
  it('codex passes the model by protocol', () => { const r = rig(); r.reg.attach({ agentId: 'c', engine: 'codex', setModel: () => undefined }); expect(r.reg.resolve('c').passAs).toBe('protocol'); });
  it('an explicit input wins for that call', () => { expect(rig({ config: { model: 'x' } }).reg.resolve('a1', 'typed').model).toBe('typed'); });
  it('the engine-reported model is what is current when nothing is configured', () => { const r = rig(); r.reg.onEvent('a1', { type: 'session.started', model: 'claude-x' }); expect(r.reg.current('a1')).toMatchObject({ model: 'claude-x', source: 'engine-reported' }); void createModelRegistry; });
});
