/** `PtyHarness`: runs a program on a real pseudo terminal and lets a test type at it and read the screen.
 *  The terminal comes from Python's standard `pty` module (no native add-on, so no install script); Linux and macOS only. */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Screen, type Cell } from './screen.js';

export interface PtyOptions { cols?: number; rows?: number; cwd?: string; env?: Record<string, string>; /** keep HOME and CENTCOM_* dirs of the caller instead of fresh temp folders */ inheritDirs?: boolean }
const KEYS: Record<string, string> = { enter: '\r', esc: '\u001b', up: '\u001b[A', down: '\u001b[B', right: '\u001b[C', left: '\u001b[D', tab: '\t', 'ctrl-c': '\u0003', 'ctrl-d': '\u0004', backspace: '\u007f' };
const HELPER = fileURLToPath(new URL('./pty-helper.py', import.meta.url));
const live = new Set<PtyHarness>();
export const livePtys = (): number => live.size;

export class PtyHarness {
  private exit?: number; private exited: Promise<number>; private readonly emu: Screen; private dirs: string[] = []; private env: Record<string, string>;
  private constructor(private child: ChildProcess, emu: Screen, dirs: string[], env: Record<string, string>) {
    this.emu = emu; this.dirs = dirs; this.env = env; live.add(this);
    child.stdout!.on('data', (d: Buffer) => { void emu.write(d); }); child.stderr!.on('data', () => undefined); child.stdin!.on('error', () => undefined);
    this.exited = new Promise((res) => child.on('close', (code, sig) => { this.exit = code ?? (sig ? 128 + 9 : 1); live.delete(this); void this.cleanup().then(() => res(this.exit!)); }));
  }
  static async spawn(cmd: string, args: string[] = [], o: PtyOptions = {}): Promise<PtyHarness> {
    const cols = o.cols ?? 100; const rows = o.rows ?? 30; const dirs: string[] = []; const mk = async (n: string) => { const d = await mkdtemp(join(tmpdir(), `centcom-pty-${n}-`)); dirs.push(d); return d; };
    const home = o.inheritDirs ? process.env.HOME! : await mk('home'); const config = o.inheritDirs ? process.env.CENTCOM_CONFIG_DIR ?? '' : await mk('config'); const state = o.inheritDirs ? process.env.CENTCOM_STATE_DIR ?? '' : await mk('state');
    const env: Record<string, string> = { PATH: process.env.PATH ?? '', HOME: home, TERM: 'xterm-256color', COLORTERM: 'truecolor', LANG: 'en_US.UTF-8', TZ: 'UTC', NO_COLOR: '', ...(config ? { CENTCOM_CONFIG_DIR: config } : {}), ...(state ? { CENTCOM_STATE_DIR: state } : {}), CENTCOM_NO_UPDATE_CHECK: '1', ...o.env };
    if (env.NO_COLOR === '') delete env.NO_COLOR;
    const child = spawn('python3', [HELPER, String(cols), String(rows), '--', cmd, ...args], { cwd: o.cwd, env, stdio: ['pipe', 'pipe', 'pipe', 'pipe'] });
    await new Promise<void>((res, rej) => { child.once('spawn', () => res()); child.once('error', (e) => { void Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }))); rej(new Error(`cannot start the pty helper (is python3 installed?): ${e.message}`)); }); });
    return new PtyHarness(child, new Screen(cols, rows), dirs, env);
  }
  get exitCode(): number | undefined { return this.exit; }
  send(s: string): void { if (this.exit === undefined) this.child.stdin!.write(s); }
  press(key: 'enter' | 'esc' | 'up' | 'down' | 'left' | 'right' | 'tab' | 'ctrl-c' | (string & {})): void { this.send(KEYS[key] ?? key); }
  screen(): string[] { return this.emu.screen(); }
  cells(): Cell[][] { return this.emu.cells(); }
  /** Resolves when the screen shows `re`. Rejects after exactly `timeoutMs`, with the last screen (environment values removed) in the message. */
  waitForText(re: RegExp | string, timeoutMs = 5000): Promise<void> {
    const test = (t: string) => (typeof re === 'string' ? t.includes(re) : re.test(t));
    return new Promise((res, rej) => {
      let done = false; const finish = (f: () => void) => { if (!done) { done = true; clearTimeout(timer); clearInterval(poll); f(); } };
      const check = async () => { await this.emu.idle(); if (!done && test(this.screen().join('\n'))) finish(res); };
      const timer = setTimeout(() => finish(() => rej(new Error(`waitForText(${String(re)}) timed out after ${timeoutMs} ms. Screen:\n${this.redactedScreen()}`))), timeoutMs); const poll = setInterval(() => { void check(); }, 15); void check();
    });
  }
  private redactedScreen(): string { let t = this.screen().join('\n'); for (const v of Object.values(this.env)) if (v.length >= 4) t = t.split(v).join('[env]'); return t; }
  resize(cols: number, rows: number): void { this.emu.resize(cols, rows); (this.child.stdio[3] as NodeJS.WritableStream | null)?.write(`resize ${cols} ${rows}\n`); }
  /** Ends the program and returns its exit code. */
  async kill(): Promise<number> { if (this.exit === undefined) { (this.child.stdio[3] as NodeJS.WritableStream | null)?.write('kill\n'); setTimeout(() => this.child.kill('SIGKILL'), 1000).unref(); } return this.exited; }
  async waitForExit(timeoutMs = 5000): Promise<number> { return Promise.race([this.exited, new Promise<number>((_, rej) => setTimeout(() => rej(new Error('the program did not exit in time')), timeoutMs))]); }
  private async cleanup(): Promise<void> { this.emu.dispose(); await Promise.all(this.dirs.map((d) => rm(d, { recursive: true, force: true }))); this.dirs = []; }
}
