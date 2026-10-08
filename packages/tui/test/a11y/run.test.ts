import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { DemoEngine } from '@centcom/agent';
import { AppController } from '../../src/controller.js';
import { runLinear } from '../../src/a11y/run.js';

const wait = (ms = 40) => new Promise((r) => setTimeout(r, ms));
let ctlToStop: AppController | undefined; afterEach(() => { ctlToStop?.stop(); ctlToStop = undefined; });
async function session() {
  const ctl = new AppController({ engine: new DemoEngine({ speed: 100 }), demo: true, cwd: '/tmp', version: 't', skills: [] }); ctlToStop = ctl; await ctl.start();
  const input = new PassThrough(); let text = ''; let stop!: () => void; const stopP = new Promise<void>((r) => { stop = r; });
  const done = runLinear(ctl, { input, output: { write: (s: string) => { text += s; return true; } } }, stopP);
  const type = async (line: string, ms = 60) => { input.write(line + '\n'); await wait(ms); };
  const until = async (f: () => boolean, ms = 8000) => { const t0 = Date.now(); while (!f()) { if (Date.now() - t0 > ms) throw new Error('timeout; output so far:\n' + text); await wait(20); } };
  return { ctl, type, until, out: () => text, end: async () => { input.end(); await done; }, stop, done };
}

describe('screen-reader mode runs the whole app as plain lines', () => {
  it('says how to use it, never writes an escape or control sequence, and ends when the input ends', async () => {
    const s = await session(); await s.type('/help'); await s.type('/demo search', 100); await s.until(() => /Done\./.test(s.out()));
    expect(s.out()).toContain('screen-reader mode'); expect(s.out()).not.toMatch(/[\u001b\u0007]/); expect(s.out()).toContain('Tool: Grep'); expect(s.out()).toContain('Status: Cento is searching.');
    await s.end();
  });
  it('/help lists the commands as text and goes back to the prompt', async () => {
    const s = await session(); await s.type('/help'); await s.until(() => s.out().includes('Commands:')); expect(s.out()).toContain('/effort [low|medium|high|xhigh|max|default]: ');
    await s.until(() => s.ctl.state.mode === 'chat'); await s.end();
  });
  it('a list is asked as numbers; bad input is asked again; the right number applies; Enter cancels', async () => {
    const s = await session(); await s.type('/mode'); await s.until(() => s.out().includes('Type a number'));
    expect(s.out()).toContain('1. ask: ask before commands and edits (current)'); await s.type('9'); expect(s.out()).toContain('Please type one number from 1 to 4.');
    await s.type('3'); await s.until(() => s.ctl.state.settings.permissionMode === 'plan'); await s.until(() => s.out().includes('Status: Plan mode'));
    await s.type('/mode'); await s.until(() => (s.out().match(/Type a number/g) ?? []).length >= 3); await s.type(''); await s.until(() => s.ctl.state.mode === 'chat'); expect(s.ctl.state.settings.permissionMode).toBe('plan');
    await s.end();
  });
  it('a list of several takes numbers separated by commas, or "all"', async () => {
    const s = await session(); const r = s.ctl.pick({ title: 'Pick some', options: ['a', 'b', 'c'].map((id) => ({ id, label: 'option ' + id })) }); await s.until(() => s.out().includes('Pick some'));
    await s.type('1, 3'); expect(await r).toEqual(['a', 'c']);
    const r2 = s.ctl.pick({ title: 'Again', options: ['a', 'b'].map((id) => ({ id, label: id })) }); await s.until(() => s.out().includes('Again')); await s.type('all'); expect(await r2).toEqual(['a', 'b']); await s.end();
  });
  it('an approval is asked in words with the exact command, only y, n or a count, and nothing answers it for you', async () => {
    const s = await session(); void s.ctl.submit('/demo fix');
    await s.until(() => s.out().includes('[y/n/a]')); expect(s.out()).toMatch(/Allow Cento to use Edit: src\/auth\/session\.ts\? \[y\/n\/a\]/); await wait(300); expect(s.ctl.state.approvals).toHaveLength(1); // still waiting: no timeout, no default
    await s.type('maybe'); expect(s.out()).toContain('Please type y, n or a.'); expect(s.ctl.state.approvals).toHaveLength(1);
    await s.type('y'); await s.until(() => s.out().includes('Allow Cento to run: pnpm test auth')); await s.type('n'); await s.until(() => /Done\./.test(s.out()) || s.out().includes('Allow Cento to use Edit: src/api'), 12000); await s.end();
  });
  it('notices the app would show (errors with their explanation) are printed with Error: or Status:', async () => {
    const s = await session(); s.ctl.apply({ v: 1, seq: 1, ts: new Date().toISOString(), agent_id: s.ctl.state.activeAgent, type: 'error', code: 'provider_not_signed_in', tool_message: 'login required', fatal: true });
    await s.until(() => s.out().includes('Error: You are not signed in')); expect(s.out()).toContain('login required'); expect(s.out()).not.toContain('Error: login required\nError:'); await s.end();
  });
  it('/quit stops it', async () => { const s = await session(); await s.type('/quit'); s.stop(); await s.done; });
});
