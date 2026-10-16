import React from 'react';
import { PassThrough } from 'node:stream';
import { render } from 'ink';
import { afterEach, describe, expect, it } from 'vitest';
import { DemoEngine } from '@centcom/agent';
import { App, AppController } from '../src/index.js';

/** C031: the Unicode/ASCII fallback follows caps.unicode, not the colour depth. */
const strip = (s: string) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
let cleanup: (() => void) | undefined; afterEach(() => { cleanup?.(); cleanup = undefined; });
async function glyphBeforeToast(unicode: boolean | undefined): Promise<string> {
  const ctl = new AppController({ engine: new DemoEngine({ speed: 100 }), demo: true, cwd: process.cwd(), version: 't', skills: [] });
  const out: any = new PassThrough(); out.columns = 100; out.rows = 32; out.isTTY = true; let frame = ''; out.on('data', (d: Buffer) => { frame = d.toString(); });
  const inp: any = new PassThrough(); inp.isTTY = true; inp.setRawMode = () => inp; inp.ref = () => inp; inp.unref = () => inp;
  const inst = render(<App ctl={ctl} tier="truecolor" {...(unicode === undefined ? {} : { unicode })} />, { stdout: out, stdin: inp, exitOnCtrlC: false, patchConsole: false, debug: true }); cleanup = () => { inst.unmount(); ctl.stop(); };
  await new Promise((r) => setTimeout(r, 60)); ctl.toast('error', 'careful now');
  const t0 = Date.now(); let m: RegExpExecArray | null = null; while (!(m = /(\S+)\s+careful now/.exec(strip(frame)))) { if (Date.now() - t0 > 6000) throw new Error('no toast:\n' + strip(frame)); await new Promise((r) => setTimeout(r, 20)); }
  return m[1]!;
}
describe('caps.unicode switches the glyphs', () => {
  it('unicode off at full colour: the toast icon is plain ASCII; on (or unset with colour): it is a symbol', async () => {
    const off = await glyphBeforeToast(false); cleanup?.(); expect(off).toMatch(/^[\x20-\x7e]+$/);
    const on = await glyphBeforeToast(true); cleanup?.(); expect(on).toMatch(/[^\x20-\x7e]/);
    const unset = await glyphBeforeToast(undefined); expect(unset).toBe(on);
  });
});
