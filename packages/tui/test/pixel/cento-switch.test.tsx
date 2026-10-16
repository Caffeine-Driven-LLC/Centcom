import React from 'react';
import { PassThrough } from 'node:stream';
import { render } from 'ink';
import { describe, expect, it } from 'vitest';
import { Cento } from '../../src/pixel/Cento.js';
import type { FrameCache } from '../../src/pixel/cache.js';

const strip = (s: string) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
const cache: FrameCache = { frames: (a) => (a === 'long' ? [0, 1, 2, 3, 4, 5].map((n) => ({ d: 10, lines: [`long${n}`] })) : [0, 1].map((n) => ({ d: 10, lines: [`short${n}`] }))), lines: () => [], size: () => 0 };
const budget = { acquire: () => true, release: () => undefined, subscribe: () => () => undefined } as never;

describe('Cento: switching to a shorter animation while on a late frame', () => {
  it('shows the new animation instead of crashing (the app died on /demo fix)', async () => {
    const out: any = new PassThrough(); out.columns = 40; out.rows = 10; out.isTTY = true; let frame = ''; out.on('data', (d: Buffer) => { frame = strip(d.toString()); });
    const inp: any = new PassThrough(); inp.isTTY = true; inp.setRawMode = () => inp; inp.ref = () => inp; inp.unref = () => inp;
    const el = (a: string) => <Cento animation={a} cache={cache} budget={budget} />; const inst = render(el('long'), { stdout: out, stdin: inp, exitOnCtrlC: false, patchConsole: false, debug: true });
    await new Promise((r) => setTimeout(r, 38)); // the long one is on frame 3 or so
    inst.rerender(el('short')); await new Promise((r) => setTimeout(r, 40)); expect(frame).toMatch(/short[01]/); inst.unmount();
  });
});
