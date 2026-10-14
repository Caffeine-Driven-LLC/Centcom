import React from 'react';
import { PassThrough } from 'node:stream';
import { render } from 'ink';
import { afterEach, describe, expect, it } from 'vitest';
import { DemoEngine } from '@centcom/agent';
import { App, AppController } from '../../src/index.js';

/** Lane C041 in the app: ctrl+k opens the palette with the providers the controller builds (commands, files, sessions, skills), a query ranks across them, Enter runs the choice and Esc gives the prompt back with its text. */
const strip = (s: string) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
let cleanup: (() => void) | undefined; afterEach(() => { cleanup?.(); cleanup = undefined; });
async function mount() {
  const ctl = new AppController({ engine: new DemoEngine({ speed: 100 }), demo: true, cwd: process.cwd(), version: 't', skills: [] });
  const out: any = new PassThrough(); out.columns = 100; out.rows = 32; out.isTTY = true; let frame = ''; out.on('data', (d: Buffer) => { frame = d.toString(); });
  const inp: any = new PassThrough(); inp.isTTY = true; inp.setRawMode = () => inp; inp.ref = () => inp; inp.unref = () => inp;
  const inst = render(<App ctl={ctl} tier="none" />, { stdout: out, stdin: inp, exitOnCtrlC: false, patchConsole: false, debug: true }); cleanup = () => { inst.unmount(); ctl.stop(); };
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms)); await wait(60);
  const until = async (f: (s: string) => boolean, ms = 6000) => { const t0 = Date.now(); while (!f(strip(frame))) { if (Date.now() - t0 > ms) throw new Error('timeout; screen:\n' + strip(frame)); await wait(20); } };
  return { ctl, send: async (s: string) => { inp.write(s); await wait(40); }, until, screen: () => strip(frame) };
}
describe('the palette in the app', { timeout: 30_000 }, () => {
  it('ctrl+k opens it with the commands group first; typing finds a command and a file together; Enter runs a command', async () => {
    const t = await mount(); await t.send('\x0b'); await t.until((s) => /Recent|Commands/.test(s) && /esc/i.test(s));
    await t.send('help'); await t.until((s) => /\/help/.test(s)); expect(t.screen()).toMatch(/Commands/);
    await t.send('\x7f\x7f\x7f\x7f'); await t.send('readme'); await t.until((s) => /README\.md/i.test(s) && /Files/.test(s)); // the files provider lists the folder's own files
    await t.send('\x1b'); await t.until((s) => !/type to search/.test(s)); expect(t.ctl.state.mode).toBe('chat');
  });
  it('Esc closes it and the text typed before is still in the prompt', async () => {
    const t = await mount(); await t.send('draft text'); await t.send('\x0b'); await t.until((s) => /type to search/.test(s)); await t.send('\x1b'); await t.until((s) => !/type to search/.test(s)); expect(t.ctl.state.input).toBe('draft text');
  });
});
