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
