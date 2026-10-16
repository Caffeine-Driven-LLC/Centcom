import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { captureTurns, effortsFor, fitEffort, flagValues, parseInitializeModels, resolveModel, ClaudeCodeEngine, fallbackModels, CLAUDE_MODELS } from '../../src/index.js';

/** Recorded `initialize` answers of two CLI versions (models only, no account fields). */
const rec = (v: string): string => readFileSync(resolve(__dirname, `../fixtures/claude-initialize-${v}.jsonl`), 'utf8').trim();
const old = parseInitializeModels(rec('2.1.289'))!; const cur = parseInitializeModels(rec('2.1.301'))!;

describe('the effort levels come from the CLI, per model', () => {
  it('reads every model with the levels it takes', () => {
    expect(effortsFor(cur, 'sonnet')).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
    expect(effortsFor(cur, 'claude-opus-5-5')).toEqual(['low', 'medium', 'high', 'xhigh', 'max']); // a full id finds the row its alias resolves to
    expect(effortsFor(cur, '')).toEqual(['low', 'medium', 'high', 'xhigh', 'max']); // the CLI's own default
    expect(effortsFor(cur, 'claude-fable-5-1')).toHaveLength(5);
  });
  it('the 4.6 models have no xhigh', () => {
    for (const m of ['claude-opus-4-6', 'claude-sonnet-4-6']) expect(effortsFor(cur, m)).toEqual(['low', 'medium', 'high', 'max']);
  });
  it('the alias haiku means different models in different CLI versions, and what they take follows', () => {
    expect(resolveModel(old, 'haiku')!.resolved).toBe('claude-haiku-4-5-20251001'); expect(effortsFor(old, 'haiku')).toEqual([]);
    expect(resolveModel(cur, 'haiku')!.resolved).toBe('claude-haiku-5-5'); expect(effortsFor(cur, 'haiku')).toHaveLength(5);
    expect(effortsFor(cur, 'claude-haiku-4-5-20251001')).toEqual([]); expect(effortsFor(old, 'claude-haiku-4-5-20251001')).toEqual([]);
    expect(effortsFor(old, 'claude-sonnet-9-9')).toEqual(['low', 'medium', 'high']); // not listed by that CLI: only the levels every model takes
  });
  it('picks the closest supported level', () => {
    expect(fitEffort('xhigh', ['low', 'medium', 'high', 'max'])).toBe('high'); expect(fitEffort('max', ['low', 'medium'])).toBe('medium');
    expect(fitEffort('medium', ['low', 'medium'])).toBe('medium'); expect(fitEffort('high', [])).toBe(''); expect(fitEffort('', ['low'])).toBe('');
  });
  it('the fallback list is used only when the query has no answer', () => { expect(fallbackModels(CLAUDE_MODELS.filter((m) => m.id)).find((m) => m.id === 'haiku')!.efforts).toEqual([]); expect(effortsFor([], 'sonnet')).toHaveLength(5); });
});

describe('--effort is only passed when the model takes it', () => {
  const run = async (start: { model: string; effort: string }, line: string) => captureTurns(['a'], start, { modelsResponse: line });
  it('passes a supported level', async () => { const c = await run({ model: 'claude-opus-4-6', effort: 'high' }, rec('2.1.301')); expect(flagValues(c.argv[0]!, '--effort')).toEqual(['high']); });
  it('drops xhigh on a 4.6 model and says so', async () => {
    const c = await run({ model: 'claude-sonnet-4-6', effort: 'xhigh' }, rec('2.1.301')); expect(flagValues(c.argv[0]!, '--effort')).toEqual([]);
    expect(c.events.some((e) => e.type === 'engine.warning' && (e as { code: string }).code === 'effort_not_supported')).toBe(true);
  });
  it('drops any level on a model without effort', async () => {
    const c = await run({ model: 'claude-haiku-4-5-20251001', effort: 'medium' }, rec('2.1.301')); expect(flagValues(c.argv[0]!, '--effort')).toEqual([]);
    const o = await run({ model: 'haiku', effort: 'medium' }, rec('2.1.289')); expect(flagValues(o.argv[0]!, '--effort')).toEqual([]);
  });
  it('the same alias takes effort where the CLI says it does', async () => { const c = await run({ model: 'haiku', effort: 'medium' }, rec('2.1.301')); expect(flagValues(c.argv[0]!, '--effort')).toEqual(['medium']); });
  it('listModels asks once per session and falls back when the CLI does not answer', async () => {
    let asks = 0;
    const spawn = (() => { asks++; const c = new EventEmitter(); Object.assign(c, { stdin: new PassThrough(), stdout: new PassThrough(), kill: () => true }); setImmediate(() => c.emit('close', 1, null)); return c; }) as never;
    const s = await new ClaudeCodeEngine({ spawn }).start({ agentId: 'a', cwd: '/' }) as unknown as { listModels(): Promise<{ id: string; efforts?: string[] }[]> };
    const a = await s.listModels(); await s.listModels(); expect(asks).toBe(1); expect(a.find((m) => m.id === 'sonnet')!.efforts).toHaveLength(5);
  });
});
