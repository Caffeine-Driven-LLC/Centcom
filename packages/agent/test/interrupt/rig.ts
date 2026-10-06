import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createProcessRegistry, type LadderClock, type Sig } from '../../src/index.js';

export const proc = (name: string) => fileURLToPath(new URL(`../fixtures/procs/${name}.mjs`, import.meta.url));
/** Starts a fixture in its own process group and waits for its "ready" line. */
export async function start(name: string): Promise<{ child: ChildProcess; ready: string; exited: Promise<void> }> {
  const child = spawn(process.execPath, [proc(name)], { stdio: ['ignore', 'pipe', 'inherit'], detached: process.platform !== 'win32' });
  const exited = new Promise<void>((res) => child.once('exit', () => res()));
  const ready = await new Promise<string>((res, rej) => { let b = ''; child.stdout!.setEncoding('utf8'); child.stdout!.on('data', (c: string) => { b += c; const i = b.indexOf('\n'); if (i >= 0) res(b.slice(0, i)); }); child.once('exit', () => rej(new Error('exited early'))); });
  return { child, ready, exited };
}
export const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
/** A registry that records every signal it sends. */
export function recording() { const sent: { pid: number; sig: Sig }[] = []; const procs = createProcessRegistry({ kill: (pid, sig) => { sent.push({ pid, sig }); process.kill(pid, sig); } }); return { procs, sent }; }

/** A clock that only moves when told. */
export function manualClock(): LadderClock & { now(): number; advance(ms: number): Promise<void> } {
  let t = 0; const timers: { at: number; f: () => void; id: number }[] = []; let n = 0;
  return {
    now: () => t, setTimeout: (f, ms) => { const id = ++n; timers.push({ at: t + ms, f, id }); return id; }, clearTimeout: (h) => { const i = timers.findIndex((x) => x.id === h); if (i >= 0) timers.splice(i, 1); },
    async advance(ms) { const end = t + ms; for (;;) { await new Promise((r) => setImmediate(r)); timers.sort((a, b) => a.at - b.at); const x = timers[0]; if (!x || x.at > end) break; timers.shift(); t = x.at; x.f(); } t = end; await new Promise((r) => setImmediate(r)); },
  };
}
