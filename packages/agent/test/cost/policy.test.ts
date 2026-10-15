import { describe, expect, it } from 'vitest';
import { captureTurns, flagValues, isTopTier, resolveModelPolicy, tierOf } from '../../src/index.js';

const config = { model: 'sonnet', effort: 'medium', subagent_model: 'sonnet' };

describe('model and effort policy', () => {
  it('knows the price tier of ids and aliases', () => {
    expect(['haiku', 'claude-haiku-4-5-20251001', 'sonnet', 'claude-sonnet-5-5', 'opus', 'claude-opus-5-5', 'claude-fable-5-1', 'gpt-x'].map(tierOf)).toEqual(['haiku', 'haiku', 'sonnet', 'sonnet', 'opus', 'opus', 'fable', 'other']);
    expect(isTopTier('claude-opus-5-5')).toBe(true); expect(isTopTier('sonnet')).toBe(false); expect(isTopTier('')).toBe(false);
  });
  it('defaults to the mid-tier model, medium effort and mid-tier helpers', () => {
    expect(resolveModelPolicy({ config })).toEqual({ model: 'sonnet', source: 'config', effort: 'medium', subagentModel: 'sonnet' });
  });
  it('uses what the person chose, whatever it is, and keeps helpers no dearer than the conversation', () => {
    const p = resolveModelPolicy({ chosen: 'claude-opus-5-5', config });
    expect(p).toMatchObject({ model: 'claude-opus-5-5', source: 'chosen', effort: 'medium', subagentModel: 'sonnet' });
    const h = resolveModelPolicy({ chosen: 'haiku', config }); expect(h).toMatchObject({ model: 'haiku', effort: '', subagentModel: '' });
  });
  it('an empty agent.model leaves the CLI default alone; the person\'s own sub-agent variable wins', () => {
    expect(resolveModelPolicy({ config: { ...config, model: '', effort: '', subagent_model: '' } })).toMatchObject({ model: '', effort: '', subagentModel: '' });
    expect(resolveModelPolicy({ config, envSubagentModel: 'opus' }).subagentModel).toBe('');
  });
});

describe('the policy reaches the claude process', () => {
  it('passes --model and --effort on every turn and the sub-agent model in the environment', async () => {
    const cap = await captureTurns(['a', 'b'], { model: 'sonnet', effort: 'medium', subagentModel: 'sonnet' });
    for (const a of cap.argv) { expect(flagValues(a, '--model')).toEqual(['sonnet']); expect(flagValues(a, '--effort')).toEqual(['medium']); }
    for (const e of cap.envs) expect(e.CLAUDE_CODE_SUBAGENT_MODEL).toBe('sonnet');
  });
  it('an explicit model is passed as given, and nothing is set when nothing is configured', async () => {
    const o = await captureTurns(['a'], { model: 'claude-opus-5-5' }); expect(flagValues(o.argv[0]!, '--model')).toEqual(['claude-opus-5-5']); expect(flagValues(o.argv[0]!, '--effort')).toEqual([]);
    const none = await captureTurns(['a'], {}); expect(flagValues(none.argv[0]!, '--model')).toEqual([]);
  });
  it('never overrides the sub-agent model the person set in their own environment', async () => {
    const prev = process.env.CLAUDE_CODE_SUBAGENT_MODEL; process.env.CLAUDE_CODE_SUBAGENT_MODEL = 'haiku';
    try { const cap = await captureTurns(['a'], { subagentModel: 'sonnet' }); expect(cap.envs[0]!.CLAUDE_CODE_SUBAGENT_MODEL).toBe('haiku'); }
    finally { if (prev === undefined) delete process.env.CLAUDE_CODE_SUBAGENT_MODEL; else process.env.CLAUDE_CODE_SUBAGENT_MODEL = prev; }
  });
});
