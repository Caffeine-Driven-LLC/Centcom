import { afterEach, describe, expect, it } from 'vitest';
import { FakeEngine } from '@centcom/testkit';
import { AppController } from '../src/controller.js';

let ctl: AppController | undefined; afterEach(() => { ctl?.stop(); ctl = undefined; });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (f: () => boolean, ms = 5000) => { const t0 = Date.now(); while (!f()) { if (Date.now() - t0 > ms) throw new Error('timeout'); await wait(15); } };
const rig = (both = true) => {
  const claude = new FakeEngine({ id: 'claude-code', script: {} }); const codex = new FakeEngine({ id: 'codex', script: {} }); const chosen: string[] = [];
  ctl = new AppController({ engine: claude as never, demo: false, cwd: '/tmp', version: 't', skills: [], ...(both ? { engines: { 'claude-code': () => claude as never, codex: () => codex as never }, onEngine: (id) => chosen.push(id) } : {}) });
  return { c: ctl, claude, codex, chosen };
};

describe('the model list across Claude Code and Codex', () => {
  it('lists both agents, and a model of the other one moves the conversation to it', async () => {
    const { c, claude, codex, chosen } = rig(); await c.start(); await c.submit('hello'); await until(() => !c.state.busy && c.state.items.some((i) => i.kind === 'assistant'));
    const run = c.openModels(); await until(() => c.state.mode === 'pick'); const labels = c.state.pick!.options.map((o) => o.label);
    expect(labels).toContain('Claude Code · Default'); expect(labels).toContain('Claude Code · Opus 5.5'); expect(labels).toContain('Codex · Default');
    run.catch(() => undefined); c.pickKey('cancel'); await run; expect(c.state.engineId).toBe('claude-code'); expect(codex.sessions.every((x) => x.stopped)).toBe(true); // asking Codex for its models left nothing running
    const before = codex.starts.length; await c.switchEngine('codex', 'gpt-x'); expect(c.state.engineId).toBe('codex'); expect(c.state.settings.model).toBe('gpt-x'); expect(chosen).toEqual(['codex']);
    expect(codex.starts).toHaveLength(before + 1); expect(claude.sessions.every((s) => s.stopped)).toBe(true); expect(c.state.items.some((i) => i.kind === 'user' && i.text === 'hello')).toBe(true); // the conversation stays on screen
    expect(c.state.items.some((i) => i.kind === 'notice' && /Switched to/.test((i as { text: string }).text))).toBe(true);
  });
  it('/model codex, /model codex <model> and /model claude <name> switch; the running agent is only changed in place', async () => {
    const { c, codex } = rig(); await c.start();
    await c.runCommand('/model codex gpt-9'); expect(c.state.engineId).toBe('codex'); expect(c.state.settings.model).toBe('gpt-9');
    const n = codex.starts.length; await c.runCommand('/model codex'); expect(codex.starts).toHaveLength(n); // already there
    await c.runCommand('/model claude opus 5.5'); expect(c.state.engineId).toBe('claude-code'); expect(c.state.settings.model).toBe('claude-opus-5-5');
    await c.runCommand('/model sonnet'); expect(c.state.engineId).toBe('claude-code'); // a name of the shown agent stays in place
  });
  it('does not switch while the agent is working', async () => {
    const claude = new FakeEngine({ id: 'claude-code', script: { hang: true } }); const codex = new FakeEngine({ id: 'codex', script: {} });
    ctl = new AppController({ engine: claude as never, demo: false, cwd: '/tmp', version: 't', skills: [], engines: { codex: () => codex as never } }); const c = ctl; await c.start(); await c.submit('stuck'); await until(() => c.state.busy);
    await c.switchEngine('codex'); expect(c.state.engineId).toBe('claude-code'); expect(codex.starts).toHaveLength(0);
  });
  it('with one agent installed there is no switching and the list is the old one', async () => {
    const { c, codex } = rig(false); await c.start(); const run = c.openModels(); await until(() => c.state.mode === 'pick'); expect(c.state.pick!.options.some((o) => /^Codex/.test(o.label))).toBe(false);
    c.pickKey('cancel'); await run; await c.runCommand('/model codex x'); expect(c.state.engineId).toBe('claude-code'); expect(codex.starts).toHaveLength(0);
  });
});
