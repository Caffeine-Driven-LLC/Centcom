import React from 'react';
import { PassThrough } from 'node:stream';
import { render } from 'ink';
import { afterEach, describe, expect, it } from 'vitest';
import { DemoEngine } from '@centcom/agent';
import { App, AppController } from '../src/index.js';

/** Thousands of random keys, pastes, mouse events and commands against the real app: it must not throw, and the editor and the lists must stay consistent. */
const wait = (ms = 8) => new Promise((r) => setTimeout(r, ms));
let cleanup: (() => void) | undefined; afterEach(() => { cleanup?.(); cleanup = undefined; });
function rng(seed: number) { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const KEYS = [
  'a', 'b', 'hello ', 'world', ' ', '\x7f', '\x7f', '\x1b[3~', '\x1b[D', '\x1b[C', '\x1b[A', '\x1b[B', '\x1b[1;2D', '\x1b[1;2C', '\x1b[1;5D', '\x1b[1;5C', '\x1b[H', '\x1b[F', '\x1b[1;2H', '\x1b[1;2F', '\x1b[3;5~', '\x1b[5~', '\x1b[6~',
  '\x01', '\x05', '\x15', '\x17', '\x0a', '\x18', '\x03', '\x0b', '\x12', '\x0f', '\x14', '\x0e', '\x02', '\x0c', '\t', '\x1b[Z', '\r', '\x1b', '\x1b\x1b', '\x1ba', '\x1bb', '\x1bf',
  '😀', '日本語', 'é', '\\', '@', '@pr', '@src/', '/', '/he', '/mode', '/theme', '/settings', '/find x', '/copy', '/bell', '/density', '/spinner', '/mouse', '/effort', '/help', '/fleet', '/rewind', '/night', '/permissions', '/skills', '/resume', '/export',
  '?', 'y', 'n', 's', 'q', 'j', 'k', '1', '9', '\x1b[200~line one\nline two\nline three\x1b[201~', `\x1b[200~${'x'.repeat(3000)}\x1b[201~`, `\x1b[200~${Array.from({ length: 30 }, (_, i) => `row ${i}`).join('\n')}\x1b[201~`,
  '\x1b[<64;10;5M', '\x1b[<65;10;5M', '\x1b[<0;12;8M', '\x1b[<0;12;8m', '\x1b[<0;3;3M', '\x1b[<4;9;9M',
];
async function mount(started = false) {
  const ctl = new AppController({ engine: new DemoEngine({ speed: 40 }), demo: true, cwd: '/tmp', version: 't', skills: [], mouse: true, clipboard: () => undefined, onExit: () => undefined });
  const out: any = new PassThrough(); out.columns = 90; out.rows = 28; out.isTTY = true; out.resume();
  const inp: any = new PassThrough(); inp.isTTY = true; inp.setRawMode = () => inp; inp.ref = () => inp; inp.unref = () => inp;
  const inst = render(<App ctl={ctl} tier="truecolor" />, { stdout: out, stdin: inp, exitOnCtrlC: false, patchConsole: false, debug: true });
  cleanup = () => { inst.unmount(); ctl.stop(); }; if (started) await ctl.start(); await wait(50); return { ctl, send: (s: string) => inp.write(s) };
}
const invariants = (ctl: AppController, trail: string[]) => {
  const s = ctl.state; const ctx = () => `after ${JSON.stringify(trail.slice(-6))}: input=${JSON.stringify(s.input.slice(0, 60))} cursor=${s.cursor} anchor=${s.anchor} mode=${s.mode}`;
  expect(s.cursor, ctx()).toBeGreaterThanOrEqual(0); expect(s.cursor, ctx()).toBeLessThanOrEqual(s.input.length);
  if (s.anchor !== undefined) { expect(s.anchor, ctx()).toBeGreaterThanOrEqual(0); expect(s.anchor, ctx()).toBeLessThanOrEqual(s.input.length); }
  expect(s.scroll, ctx()).toBeGreaterThanOrEqual(0); expect(Number.isFinite(s.scroll), ctx()).toBe(true);
  if (s.mode === 'pick') { expect(s.pick, ctx()).toBeDefined(); expect(s.pick!.sel, ctx()).toBeGreaterThanOrEqual(0); expect(s.pick!.sel, ctx()).toBeLessThan(Math.max(1, s.pick!.options.length)); for (const id of s.pick!.checked) expect(s.pick!.options.some((o) => o.id === id), ctx()).toBe(true); }
  if (s.mode !== 'pick') expect(s.pick === undefined || s.pick !== null, ctx()).toBe(true);
  expect(s.approvals.length, ctx()).toBeLessThan(10); expect(s.toasts.length, ctx()).toBeLessThanOrEqual(3);
  if (s.mention) expect(s.mention.sel, ctx()).toBeGreaterThanOrEqual(0);
};
describe('random input never breaks the app', () => {
  for (const seed of [1, 42, 2026]) {
    it(`seed ${seed}: 250 random keys, pastes and mouse events`, async () => {
      const { ctl, send } = await mount(); const r = rng(seed); const trail: string[] = [];
      for (let i = 0; i < 250; i++) {
        const k = KEYS[Math.floor(r() * KEYS.length)]!; trail.push(k); send(k); await wait(r() < 0.1 ? 30 : 4); invariants(ctl, trail);
        if (ctl.state.mode === 'pick' && r() < 0.15) { send('\x1b'); await wait(6); } // lists are left again so the run keeps visiting every screen
      }
      await wait(80); invariants(ctl, trail);
    }, 90_000);
  }
});

describe('random input while an agent is working', () => {
  const FLOW = ['/demo fix\r', '/demo search\r', '/demo delete\r', '/demo ask\r', '/demo error\r', '/demo compact\r', 'hello\r', 'y', 'n', 's', 'a', '\r', '\x1b', '\x1b', '\x03', '\x1b[5~', '\x1b[6~', '\x1b[<64;10;5M', '\x1b[<65;10;5M', '\x1b[<0;20;20M', '/rewind\r', '/settings\r', '/model\r'];
  for (const seed of [3, 77]) {
    it(`seed ${seed}: approvals, interrupts, lists and scrolling in any order`, async () => {
      const { ctl, send } = await mount(true); const r = rng(seed); const trail: string[] = [];
      for (let i = 0; i < 120; i++) {
        const k = (r() < 0.6 ? FLOW : KEYS)[Math.floor(r() * (r() < 0.6 ? FLOW.length : KEYS.length))] ?? 'a'; trail.push(k); send(k); await wait(r() < 0.3 ? 80 : 15); invariants(ctl, trail);
      }
      send('\x1b'); send('\x1b'); await wait(300); invariants(ctl, trail);
    }, 90_000);
  }
});
