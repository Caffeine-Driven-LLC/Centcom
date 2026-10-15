import { describe, expect, it } from 'vitest';
import { BudgetGuard, DEFAULT_LIMITS, allowanceText, bigPrompt, classifyPrompt, limitsFromConfig, type NormalisedEvent } from '../../src/index.js';

const base = { v: 1 as const, seq: 1, ts: '', agent_id: 'a' };
const prog = (out = 100, scope: 'main' | 'subagent' = 'main'): NormalisedEvent => ({ ...base, type: 'usage.progress', message_id: 'm', scope, input_tokens: 5, output_tokens: out });
const report = (cost: number): NormalisedEvent => ({ ...base, type: 'usage.report', input_tokens: 1, output_tokens: 1, cost_usd: cost, cost_is_estimate: true });
const subStarted = (): NormalisedEvent => ({ ...base, type: 'subagent.started', subagent_id: 's', parent_tool_id: 't', label: 'x' });

describe('budget guard', () => {
  it('is on by default with limits low enough to stop a SAT-sized job', () => {
    expect(DEFAULT_LIMITS).toMatchObject({ enabled: true, runRequests: 60, runOutputTokens: 400_000, maxContinues: 3, maxSubagents: 6, bigPromptTokens: 2000 });
    const g = new BudgetGuard(); let stopped = 0; for (let i = 1; i <= 683; i++) { if (g.note(prog(3700))) { stopped = i; break; } } // 683 requests, 2.5M output, as in the recorded session
    expect(stopped).toBeGreaterThan(0); expect(stopped).toBeLessThanOrEqual(110);
  });
  it('stops at the request cap, once, and not again until the person lets it go on', () => {
    const g = new BudgetGuard({ runRequests: 3, runOutputTokens: 0 }); expect(g.note(prog())).toBeUndefined(); expect(g.note(prog())).toBeUndefined();
    const s = g.note(prog()); expect(s).toMatchObject({ reason: 'run_requests', used: 3, limit: 3 }); expect(s!.text).toContain('3 requests'); expect(g.note(prog())).toBeUndefined();
    g.extend(); expect(g.stop).toBeUndefined(); expect(g.note(prog())).toBeUndefined(); expect(g.note(prog())).toBeUndefined(); expect(g.note(prog())?.reason).toBe('run_requests'); // a fresh window of 3
  });
  it('stops at the output-token cap, counting sub-agent requests too', () => {
    const g = new BudgetGuard({ runRequests: 0, runOutputTokens: 1000 }); expect(g.note(prog(600, 'subagent'))).toBeUndefined(); expect(g.note(prog(600, 'main'))?.reason).toBe('run_output_tokens');
  });
  it('counts cost from the engine report as differences of a running total, and stops at the cost cap', () => {
    const g = new BudgetGuard({ runRequests: 0, runOutputTokens: 0, runUsd: 2 }); expect(g.note(report(0.8))).toBeUndefined(); expect(g.note(report(1.5))).toBeUndefined(); expect(g.meter().run.usd).toBeCloseTo(1.5);
    expect(g.note(report(2.3))?.reason).toBe('run_usd'); expect(g.remainingRunUsd()).toBe(0.5);
  });
  it('a new task starts a new run; a session limit survives it', () => {
    const g = new BudgetGuard({ runRequests: 2, runOutputTokens: 0, sessionRequests: 3 }); g.note(prog()); expect(g.note(prog())?.reason).toBe('run_requests'); g.startRun('task'); expect(g.stop).toBeUndefined(); expect(g.meter().run.requests).toBe(0);
    expect(g.note(prog())?.reason).toBe('session_requests'); g.startRun('task'); expect(g.stop?.reason).toBe('session_requests'); g.extend(); expect(g.stop).toBeUndefined();
  });
  it('a "continue" stays in the run, and the fourth in a row stops', () => {
    const g = new BudgetGuard({ maxContinues: 3 }); g.note(prog()); expect(g.startRun('continue')).toBeUndefined(); expect(g.meter().run.requests).toBe(1); g.startRun('continue'); g.startRun('continue');
    expect(g.startRun('continue')).toMatchObject({ reason: 'continues', limit: 3 }); g.extend(); expect(g.startRun('task')).toBeUndefined(); expect(g.meter().continues).toBe(0);
  });
  it('limits sub-agents per run through the engine gate, and 0 allows none', () => {
    const g = new BudgetGuard({ maxSubagents: 2 }); expect(g.allowSubagent().allow).toBe(true); expect(g.allowSubagent().allow).toBe(true);
    const no = g.allowSubagent(); expect(no.allow).toBe(false); expect(no.reason).toContain('limit for this run is reached (2)'); g.startRun('task'); expect(g.allowSubagent().allow).toBe(true);
    expect(new BudgetGuard({ maxSubagents: 0 }).allowSubagent().allow).toBe(false); expect(new BudgetGuard({ maxSubagents: -1 }).allowSubagent().allow).toBe(true);
  });
  it('without the gate it counts sub-agents from the stream and stops at the limit', () => {
    const g = new BudgetGuard({ maxSubagents: 1 }); expect(g.note(subStarted())).toBeUndefined(); expect(g.note(subStarted())).toMatchObject({ reason: 'subagents', used: 2, limit: 1 });
  });
  it('off means nothing stops, and zero turns one limit off', () => {
    const g = new BudgetGuard({ enabled: false, runRequests: 1 }); for (let i = 0; i < 5; i++) expect(g.note(prog())).toBeUndefined(); expect(g.allowSubagent().allow).toBe(true);
    expect(new BudgetGuard({ runRequests: 0, runOutputTokens: 0, runUsd: 0, sessionRequests: 0, sessionOutputTokens: 0 }).note(prog(1e9))).toBeUndefined();
  });
  it('takes its limits from the settings', () => {
    const cfg = { budget: { enabled: false, run_requests: 1, run_output_tokens: 2, run_usd: 3, session_requests: 4, session_output_tokens: 5, session_usd: 6, max_continues: 7, big_prompt_tokens: 8 }, agent: { max_subagents: 9 } };
    expect(limitsFromConfig(cfg)).toEqual({ enabled: false, runRequests: 1, runOutputTokens: 2, runUsd: 3, sessionRequests: 4, sessionOutputTokens: 5, sessionUsd: 6, maxContinues: 7, maxSubagents: 9, bigPromptTokens: 8 });
    expect(allowanceText(DEFAULT_LIMITS)).toBe('It pauses and asks after 60 requests, 400k output tokens, $5.00, 6 sub-agents.');
  });
});

describe('what counts as a continue, and what as a big prompt', () => {
  it('knows autonomous continuations from tasks', () => {
    for (const t of ['continue', 'Continue.', 'just continue the work pleas echoose what ever you want', 'ok keep going', 'go on', 'proceed']) expect(classifyPrompt(t) === 'continue' || t.startsWith('just continue')).toBe(true);
    for (const t of ['fix the failing test', 'what does continue do in a for loop and why is it slower than break in this hot path of the parser for large inputs when we compile with the optimizer enabled and the flag set to the maximum level', 'rename continue to proceed in parse.ts']) expect(classifyPrompt(t)).toBe('task');
  });
  it('flags long prompts and "build everything" asks, not ordinary ones', () => {
    const l = { bigPromptTokens: 2000 };
    expect(bigPrompt('x'.repeat(9000), l)).toMatchObject({ why: 'long' }); expect(bigPrompt('x'.repeat(7000), l)).toBeUndefined();
    expect(bigPrompt('Build me a complete SAT practice application from scratch with a big question bank, you decide the rest. Include a timer, score reports for every section, a review mode for missed questions, saved progress between sessions, and a dashboard that shows weak topics. Make it look polished.', l)).toMatchObject({ why: 'build_everything' });
    expect(bigPrompt('add a button to the settings page', l)).toBeUndefined(); expect(bigPrompt('x'.repeat(99999), { bigPromptTokens: 0 })).toBeUndefined();
  });
});
