import { afterEach, describe, expect, it } from 'vitest';
import { FakeEngine, type FakeEngineOptions } from '@centcom/testkit';
import { AppController } from '../src/controller.js';

let ctl: AppController | undefined; afterEach(() => { ctl?.stop(); ctl = undefined; });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (f: () => boolean, ms = 5000) => { const t0 = Date.now(); while (!f()) { if (Date.now() - t0 > ms) throw new Error('timeout'); await wait(15); } };
const make = (o: FakeEngineOptions) => { ctl = new AppController({ engine: new FakeEngine(o) as never, demo: false, cwd: '/tmp', version: 't', skills: [] }); return ctl; };
const notices = (c: AppController) => c.state.items.filter((i) => i.kind === 'notice') as { level: string; text: string; detail?: string }[];

describe('when the agent misbehaves, the app keeps working and says what happened', () => {
  it('a crash in the middle of a turn: not busy any more, an error you can read, and the next message works', async () => {
    let turns = 0; const c = make({ script: () => (++turns === 1 ? { events: [{ type: 'status', state: 'thinking' }], crash: { signal: 'SIGKILL' } } : {}) }); await c.start();
    await c.submit('first'); await until(() => !c.state.busy && notices(c).length > 0); expect(notices(c).some((n) => n.level === 'error' && /stopped unexpectedly/.test(n.text))).toBe(true); expect(c.state.items.some((i) => i.kind === 'tool' && i.status === 'running')).toBe(false);
    await c.submit('second'); await until(() => !c.state.busy && c.state.items.some((i) => i.kind === 'assistant')); expect(c.state.busy).toBe(false); expect(turns).toBe(2); // restarted, not stuck
  });
  it('an engine that cannot start: start() says why, so the launcher can print it', async () => {
    const c = make({ failStart: Object.assign(new Error('claude: command not found'), { code: 'provider_not_installed' }) });
    await expect(c.start()).rejects.toThrow(/command not found/); expect(c.state.busy).toBe(false); // the caller (main) prints it and exits 1
  });
  it('the agent\'s stream ending without a word is not mistaken for a crash when we stop it on purpose (/new, resume)', async () => {
    const c = make({ script: {} }); await c.start(); await c.submit('hello'); await until(() => !c.state.busy && c.state.items.some((i) => i.kind === 'assistant'));
    await c.runCommand('/new'); await wait(100); expect(notices(c).some((n) => /stopped unexpectedly/.test(n.text))).toBe(false); await c.submit('after new'); await until(() => c.state.items.some((i) => i.kind === 'assistant')); c.stop(); await wait(50);
  });
  it('an interrupt ends a hanging turn, and the app can be used again', async () => {
    const c = make({ script: [{ hang: true }, {}] }); await c.start(); await c.submit('stuck'); await until(() => c.state.busy); await c.interrupt(); await until(() => !c.state.busy, 8000);
    await c.submit('again'); await until(() => c.state.items.filter((i) => i.kind === 'assistant').length > 0);
  });
});

describe('review fixes: restarts, questions, and what is left open', () => {
  it('two quick messages after the agent died start the agent once, not twice', async () => {
    let turns = 0; const fake = new FakeEngine({ script: () => (++turns === 1 ? { events: [{ type: 'status', state: 'thinking' }], crash: { signal: 'SIGKILL' } } : {}), startDelayMs: 0 }); ctl = new AppController({ engine: fake as never, demo: false, cwd: '/tmp', version: 't', skills: [] }); const c = ctl; await c.start();
    await c.submit('first'); await until(() => !c.state.busy && c.state.items.some((i) => i.kind === 'notice')); expect(fake.starts).toHaveLength(1);
    const a = c.submit('second'); const b = c.submit('third'); await Promise.all([a, b]); await until(() => !c.state.busy); expect(fake.starts).toHaveLength(2); // one restart for both
    expect(fake.sessions.filter((s) => !s.dead).length).toBe(1); // no orphan left running
  });
  it('an approval that was waiting for a dead agent is declined, not left on screen', async () => {
    const fake = new FakeEngine({ script: { hang: true } }); ctl = new AppController({ engine: fake as never, demo: false, cwd: '/tmp', version: 't', skills: [] }); const c = ctl; await c.start(); await c.submit('x'); await until(() => c.state.busy);
    const d = c.decide({ approval_id: 'p', agent_id: c.state.activeAgent, tool_id: 't', tool: 'Bash', summary: 'x', risk: 'medium', command: 'npm test' } as never); await until(() => c.state.approvals.length === 1); (fake.sessions[0] as any).crash('SIGKILL');
    await until(() => !c.state.busy); expect(await d).toMatchObject({ decision: 'deny' }); expect(c.state.approvals).toHaveLength(0);
  });
  it('Esc on a question that waits for typing only declines the question; the turn goes on', async () => {
    const fake = new FakeEngine({ script: { hang: true } }); ctl = new AppController({ engine: fake as never, demo: false, cwd: '/tmp', version: 't', skills: [] }); const c = ctl; await c.start(); await c.submit('x'); await until(() => c.state.busy);
    const r = (c as any).askEngine([{ id: 'q', text: 'Name?' }]) as Promise<unknown>; await wait(20); expect(c.awaitingAnswer).toBe(true); await c.interrupt(); expect(await r).toBeUndefined(); expect(c.awaitingAnswer).toBe(false);
    expect(c.state.busy).toBe(true); expect(fake.sessions[0]!.interrupts).toBe(0); await c.interrupt(); await until(() => fake.sessions[0]!.interrupts > 0 || !c.state.busy); // the second Esc stops the turn
  });
  it('a typed answer expands pasted chips, a secret one is shown as dots, and an emptied prompt forgets its chips', async () => {
    const c = new AppController({ engine: new FakeEngine() as never, demo: true, cwd: '/tmp', version: 't', skills: [] }); ctl = c; const big = Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n');
    const r = (c as any).askEngine([{ id: 'p', text: 'Password?', secret: true }, { id: 'n', text: 'Notes?' }]) as Promise<Record<string, string[]>>; await wait(10); expect(c.state.maskInput).toBe(true);
    await c.submit('hunter2'); await wait(10); expect(c.state.maskInput).toBeFalsy(); const chip = c.pastes.add(big).insert; expect(chip).toMatch(/^\[Pasted text #1/); c.patch({ input: chip, cursor: chip.length }); await c.submit(chip); expect(await r).toEqual({ p: ['hunter2'], n: [big] });
    const again = c.pastes.add(big).insert; c.patch({ input: again, cursor: again.length }); c.patch({ input: '', cursor: 0 }); expect(c.pastes.expand(again)).toBe(again); // nothing left to expand
  });
});
