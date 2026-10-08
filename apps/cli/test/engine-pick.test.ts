import { describe, expect, it } from 'vitest';
import { chooseEngine, type EngineName } from '../src/engine-pick.js';

const run = (have: EngineName[], o: { demo?: boolean; explicit?: EngineName; preferred?: EngineName } = {}) => chooseEngine({ demo: !!o.demo, explicit: o.explicit, preferred: o.preferred, installed: async (e) => have.includes(e) });
describe('which agent starts', () => {
  it('the wanted one when it is installed; Claude Code is the default', async () => {
    expect(await run(['claude-code', 'codex'])).toEqual({ engine: 'claude-code', note: '' }); expect(await run(['claude-code', 'codex'], { preferred: 'codex' })).toEqual({ engine: 'codex', note: '' }); expect(await run(['codex'], { explicit: 'codex' })).toEqual({ engine: 'codex', note: '' });
  });
  it('a remembered agent that is gone falls back to the other installed one, and says so', async () => {
    const r = await run(['claude-code'], { preferred: 'codex' }); expect(r.engine).toBe('claude-code'); expect(r.note).toContain('Codex was not found, so this session uses Claude Code'); expect(r.note).toContain('codex login');
    const q = await run(['codex']); expect(q.engine).toBe('codex'); expect(q.note).toContain('Claude Code was not found, so this session uses Codex');
  });
  it('an agent asked for with --engine is never swapped silently: demo with the install hint', async () => {
    const r = await run(['claude-code'], { explicit: 'codex' }); expect(r.engine).toBe('demo'); expect(r.note).toContain('Codex was not found, so this is the demo agent');
  });
  it('neither installed is the demo; --demo is always the demo', async () => {
    expect((await run([])).engine).toBe('demo'); expect((await run([])).note).toContain('Install Claude Code'); expect(await run(['claude-code'], { demo: true })).toEqual({ engine: 'demo', note: '' });
  });
});
