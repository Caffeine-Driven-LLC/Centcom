import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { DemoEngine } from '@centcom/agent';
import { AppController } from '../../src/controller.js';
import { runLinear } from '../../src/a11y/run.js';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
let ctlToStop: AppController | undefined; afterEach(() => { ctlToStop?.stop(); ctlToStop = undefined; });
function rng(seed: number) { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const LINES = ['hello', '', '   ', '/help', '/mode', '/theme', '/settings', '/find hello', '/copy', '/model', '/cento', '/night', '/fleet', '/rewind', '/resume', '/permissions', '/skills', '/effort', '/bell on', '/demo fix', '/demo search', '/demo delete', '/demo ask',
  'y', 'n', 'a', 'yes', 'maybe', '1', '2', '3', '9', '0', '-1', '1,2', '1 2', 'all', 'x', '\x1b[31mred\x1b[0m', '\x1b]0;title\x07', 'text with \x1b[2J clear', 'tab\there', 'ünïcödé 😀 日本語', '@src', 'a'.repeat(300), '/nonsense', '/mouse off', '/quit-not'];
describe('screen-reader mode under random input', () => {
  for (const seed of [5, 13, 99]) {
    it(`seed ${seed}: 60 random lines never produce an escape code, never hang, and always end when the input ends`, async () => {
      const ctl = new AppController({ engine: new DemoEngine({ speed: 100 }), demo: true, cwd: '/tmp', version: 't', skills: [], clipboard: () => undefined, onExit: () => undefined }); ctlToStop = ctl; await ctl.start();
      const input = new PassThrough(); let text = ''; const done = runLinear(ctl, { input, output: { write: (s: string) => { text += s; return true; } } }); const r = rng(seed);
      for (let i = 0; i < 60; i++) { input.write(LINES[Math.floor(r() * LINES.length)]! + '\n'); await wait(r() < 0.25 ? 120 : 15); }
      input.end(); const ended = await Promise.race([done.then(() => true), wait(15_000).then(() => false)]);
      expect(ended, 'the loop did not end when the input ended; last output:\n' + text.slice(-600)).toBe(true);
      expect(text).not.toMatch(/[\u001b\u0007]/); expect(text).not.toMatch(/[\u0000-\u0008\u000b-\u001a\u001c-\u001f\u007f]/); expect(text.length).toBeGreaterThan(200);
    }, 60_000);
  }
});
