/** `renderInk`: draws an Ink component to a fake terminal and returns what it printed, for tests. */
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ReactElement } from 'react';
import { render } from 'ink';
import { expect } from 'vitest';

export type ColorTier = 'truecolor' | '256' | '16' | 'none';
const LEVEL: Record<ColorTier, 0 | 1 | 2 | 3> = { none: 0, '16': 1, '256': 2, truecolor: 3 };
/** Ink draws colour with its own copy of chalk; its level is set on that same module instance. */
async function setChalkLevel(tier: ColorTier): Promise<void> {
  const inkPath = createRequire(import.meta.url).resolve('ink'); const chalkPath = createRequire(inkPath).resolve('chalk');
  const mod = (await import(pathToFileURL(chalkPath).href)) as { default: { level: number } }; mod.default.level = LEVEL[tier];
}
export const stripAnsi = (s: string): string => s.replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g, '').replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '');
export interface InkTestRun { frames: string[]; lastFrame(): string; screen(): string[]; stdin: { write(s: string): void }; rerender(el: ReactElement): void; unmount(): void }

class FakeOut extends EventEmitter { columns: number; rows: number; isTTY = true; frames: string[] = []; constructor(c: number, r: number) { super(); this.columns = c; this.rows = r; } write(d: string) { this.frames.push(String(d)); return true; } end() {} cork() {} uncork() {} }
class FakeIn extends EventEmitter { isTTY = true; data: string[] = []; setRawMode() { return this; } setEncoding() {} resume() { return this; } pause() { return this; } ref() { return this; } unref() { return this; } read() { return this.data.shift() ?? null; } write(s: string) { this.data.push(s); this.emit('readable'); this.emit('data', s); } }

export async function renderInk(el: ReactElement, o: { cols?: number; rows?: number; colorTier?: ColorTier } = {}): Promise<InkTestRun> {
  const cols = o.cols ?? 80; const rows = o.rows ?? 24; await setChalkLevel(o.colorTier ?? 'none');
  const out = new FakeOut(cols, rows); const stdin = new FakeIn();
  const app = render(el, { stdout: out as never, stdin: stdin as never, stderr: new FakeOut(cols, rows) as never, debug: true, patchConsole: false, exitOnCtrlC: false });
  await new Promise<void>((r) => setImmediate(r));
  const last = () => out.frames.at(-1) ?? '';
  return { frames: out.frames, lastFrame: last, screen: () => stripAnsi(last()).split('\n').map((l) => l.replace(/\s+$/, '')), stdin, rerender: (e) => app.rerender(e), unmount: () => app.unmount() };
}
/** Compares the text of a screen with the stored snapshot (ANSI removed, trailing spaces trimmed); a missing snapshot is an error under `--ci`. */
export function expectScreen(screen: string[] | string) { const text = (Array.isArray(screen) ? screen : screen.split('\n')).map((l) => stripAnsi(l).replace(/\s+$/, '')).join('\n').replace(/\n+$/, ''); return { toMatchSnapshot: (name?: string) => expect(text).toMatchSnapshot(name), text }; }
