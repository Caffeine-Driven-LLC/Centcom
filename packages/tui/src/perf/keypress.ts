/** Dev only (used by `pnpm bench`, not exported from the package): how long a key takes to reach the screen in a real Ink render of the whole app. */
import React from 'react';
import { PassThrough } from 'node:stream';
import { render } from 'ink';
import { DemoEngine } from '@centcom/agent';
import { App } from '../App.js';
import { AppController } from '../controller.js';

export async function keypressSamples(n = 30): Promise<number[]> {
  const ctl = new AppController({ engine: new DemoEngine({ speed: 100 }), demo: true, cwd: '/tmp', version: 'bench', skills: [] });
  ctl.patch({ items: Array.from({ length: 60 }, (_, i) => (i % 2 ? { id: 'a' + i, kind: 'assistant', messageId: 'm' + i, agentId: 'x', text: 'Some **markdown** text. '.repeat(10), done: true } : { id: 'u' + i, kind: 'user', text: 'hello '.repeat(20), ts: i })) as never });
  let last = 0; const out: any = new PassThrough(); out.columns = 120; out.rows = 40; out.isTTY = true; out.on('data', () => { last = performance.now(); });
  const inp: any = new PassThrough(); inp.isTTY = true; inp.setRawMode = () => inp; inp.ref = () => inp; inp.unref = () => inp;
  const inst = render(React.createElement(App, { ctl, tier: 'truecolor' }), { stdout: out, stdin: inp, exitOnCtrlC: false, patchConsole: false, maxFps: 30, incrementalRendering: true });
  await new Promise((r) => setTimeout(r, 600));
  const samples: number[] = [];
  for (let i = 0; i < n; i++) { const t = performance.now(); last = 0; inp.write('a'); while (!last && performance.now() - t < 500) await new Promise((r) => setTimeout(r, 1)); samples.push((last || performance.now()) - t); await new Promise((r) => setTimeout(r, 80)); }
  inst.unmount(); ctl.stop(); return samples;
}
