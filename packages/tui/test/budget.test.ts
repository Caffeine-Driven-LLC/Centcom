import { BudgetGuard, type EventBody } from '@centcom/agent';
import { FakeEngine, type FakeEngineOptions } from '@centcom/testkit';
import { describe, expect, it } from 'vitest';
import { AppController } from '../src/controller.js';

const until = async (f: () => boolean, ms = 4000) => { const t0 = Date.now(); while (!f()) { if (Date.now() - t0 > ms) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 10)); } };
const clock = { now: () => Date.now(), setTimeout: (f: () => void, ms: number) => setTimeout(f, ms) };
const progress = (n: number, out = 1000): EventBody[] => Array.from({ length: n }, (_, i) => ({ type: 'usage.progress', message_id: `m${i}`, scope: 'main', input_tokens: 10, output_tokens: out }));
const rig = async (limits: ConstructorParameters<typeof BudgetGuard>[0], script: NonNullable<FakeEngineOptions['script']>, interactive = true) => {
  const engine = new FakeEngine({ id: 'claude-code', clock, script }); const guard = new BudgetGuard(limits);
  const ctl = new AppController({ engine: engine as never, demo: false, cwd: '/tmp', version: 't', skills: [], budget: guard, interactive }); await ctl.start(); return { ctl, engine, guard };
};
const notices = (c: AppController) => c.state.items.filter((i) => i.kind === 'notice') as { text: string; detail?: string }[];
const hang = (n: number, out?: number) => ({ events: progress(n, out), gapMs: 5, hang: true });

describe('the budget stops a run and asks', () => {
  it('stops at the request cap: the run is interrupted, says why, and asks to keep going', async () => {
    const { ctl, engine, guard } = await rig({ runRequests: 5, runOutputTokens: 0, runUsd: 0 }, hang(30));
    await ctl.submit('refactor the parser'); await until(() => ctl.state.pick?.title === 'Paused by the budget');
    expect(engine.sessions[0]!.interrupts).toBeGreaterThanOrEqual(1); expect(guard.meter().run.requests).toBeGreaterThanOrEqual(5); expect(guard.meter().run.requests).toBeLessThan(30);
    expect(notices(ctl).some((n) => n.text.startsWith('Paused: This run has made'))).toBe(true);
    ctl.pickKey('down'); ctl.pickKey('enter'); await until(() => !ctl.state.pick); expect(ctl.state.busy).toBe(false); expect(guard.stop).toBeDefined(); ctl.stop();
  });
  it('stops at the output-token cap', async () => {
    const { ctl, guard } = await rig({ runRequests: 0, runOutputTokens: 5000, runUsd: 0 }, hang(30, 2000));
    await ctl.submit('write the whole thing'); await until(() => ctl.state.pick?.title === 'Paused by the budget'); expect(guard.stop?.reason).toBe('run_output_tokens'); expect(guard.meter().run.outputTokens).toBeLessThan(30 * 2000); ctl.pickKey('down'); ctl.pickKey('enter'); ctl.stop();
  });
  it('keep going gives a fresh allowance and continues the run', async () => {
    const { ctl, engine, guard } = await rig({ runRequests: 5, runOutputTokens: 0, runUsd: 0 }, (n) => (n === 1 ? hang(30) : { events: progress(2) }));
    await ctl.submit('big refactor'); await until(() => ctl.state.pick?.title === 'Paused by the budget'); ctl.pickKey('enter');
    await until(() => engine.sessions[0]!.prompts.length === 2); expect(engine.sessions[0]!.prompts[1]).toBe('Continue where you stopped.'); await until(() => !ctl.state.busy); expect(guard.stop).toBeUndefined(); ctl.stop();
  });
  it('with nobody to ask (print mode) it stops and records why', async () => {
    const { ctl, engine } = await rig({ runRequests: 5, runOutputTokens: 0, runUsd: 0 }, hang(30), false);
    await ctl.submit('refactor'); await until(() => !!ctl.budgetStop); await until(() => !ctl.state.busy); expect(ctl.state.pick).toBeUndefined(); expect(engine.sessions[0]!.prompts).toHaveLength(1);
    await ctl.submit('go on'); expect(engine.sessions[0]!.prompts).toHaveLength(1); ctl.stop(); // a paused run is not restarted without an answer
  });
  it('the guard can be turned off, and /budget shows the numbers', async () => {
    const { ctl, guard } = await rig({ runRequests: 3 }, { events: progress(10) });
    await ctl.runCommand('/budget off'); await ctl.submit('go'); await until(() => !ctl.state.busy); expect(guard.stop).toBeUndefined();
    await ctl.runCommand('/budget'); expect(notices(ctl).at(-1)!.text).toContain('Budget'); expect(notices(ctl).at(-1)!.detail).toContain('This run: 10 requests'); ctl.stop();
  });
});

describe('a row of "continue" messages', () => {
  it('asks before the fourth one and does not count a new task', async () => {
    const { ctl, engine } = await rig({ maxContinues: 3 }, { events: [] });
    for (const t of ['continue', 'keep going', 'just continue please']) { await ctl.submit(t); await until(() => !ctl.state.busy); }
    expect(engine.sessions[0]!.prompts).toHaveLength(3);
    void ctl.submit('choose whatever you want'); await until(() => ctl.state.pick?.title === 'Another "continue"?'); ctl.pickKey('down'); ctl.pickKey('enter'); await until(() => !ctl.state.pick);
    expect(engine.sessions[0]!.prompts).toHaveLength(3);
    await ctl.submit('now fix the failing test in parse.ts'); await until(() => engine.sessions[0]!.prompts.length === 4); ctl.stop();
  });
});

describe('a very big prompt is confirmed first', () => {
  it('shows an estimate and the allowance, and does not send when declined', async () => {
    const { ctl, engine } = await rig({ bigPromptTokens: 2000 }, { events: [] });
    const text = 'Build me a full application. ' + 'Details of the feature list go here. '.repeat(400);
    void ctl.submit(text); await until(() => ctl.state.pick?.title === 'This is a big job');
    expect(ctl.state.pick!.note).toMatch(/tokens long/); expect(ctl.state.pick!.note).toContain('pauses and asks after 60 requests');
    ctl.pickKey('down'); ctl.pickKey('enter'); await until(() => !ctl.state.pick); await new Promise((r) => setTimeout(r, 30)); expect(engine.sessions[0]!.prompts).toHaveLength(0); expect(ctl.state.input.startsWith('Build me a full application')).toBe(true);
    void ctl.submit(text); await until(() => ctl.state.pick?.title === 'This is a big job'); ctl.pickKey('enter'); await until(() => engine.sessions[0]!.prompts.length === 1); ctl.stop();
  });
  it('a short "build the whole thing" request is also confirmed; an ordinary request is not', async () => {
    const { ctl, engine } = await rig({ bigPromptTokens: 2000 }, { events: [] });
    void ctl.submit('Build me a complete SAT practice application from scratch with a big question bank, you decide the rest. Include a timer, score reports for every section, a review mode for missed questions, saved progress between sessions, and a dashboard that shows weak topics. Make it look polished.');
    await until(() => ctl.state.pick?.title === 'This is a big job'); expect(ctl.state.pick!.note).toContain('whole application'); ctl.pickKey('down'); ctl.pickKey('enter'); await until(() => !ctl.state.pick);
    await ctl.submit('rename the helper in utils.ts'); await until(() => engine.sessions[0]!.prompts.length === 1); expect(ctl.state.pick).toBeUndefined(); ctl.stop();
  });
});
