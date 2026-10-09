/** Things that need the real terminal while the app steps aside: your editor, and being put in the background. */
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export type { ExternalTask } from '@centcom/tui';

const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
/** Open `text` in the editor you use ($VISUAL, then $EDITOR, else vi) in a private temporary file and return what you saved, or undefined when the editor failed or you left it unchanged-and-empty. Always cleans up. */
export function editInEditor(text: string, o: { env?: NodeJS.ProcessEnv; run?: (cmd: string) => { status: number | null } } = {}): string | undefined {
  const env = o.env ?? process.env; const editor = (env.VISUAL || env.EDITOR || 'vi').trim();
  const dir = mkdtempSync(join(tmpdir(), 'centcom-edit-')); const file = join(dir, 'message.md');
  try {
    writeFileSync(file, text, { mode: 0o600 }); chmodSync(file, 0o600);
    const run = o.run ?? ((cmd: string) => spawnSync(cmd, { shell: true, stdio: 'inherit' })); const r = run(`${editor} ${quote(file)}`);
    if (r.status !== 0) return undefined;
    return readFileSync(file, 'utf8').replace(/\r\n/g, '\n').replace(/\n+$/, '');
  } catch { return undefined; } finally { rmSync(dir, { recursive: true, force: true }); }
}

/** Stop everything started with this job until the shell continues it: the whole process group, as the terminal's own ctrl+z does, so a wrapper (tsx) and the agent stop with the app. Resolves when it runs again. */
export function stopUntilContinued(proc: Pick<NodeJS.Process, 'kill' | 'once'> = process): Promise<void> {
  // a signal listener alone does not keep node alive: with nothing else running (the mascot's timers pause when it is not shown) the process would exit the moment it is continued
  return new Promise((resolve) => { const hold = setInterval(() => undefined, 1 << 30); const done = () => { clearInterval(hold); resolve(); }; proc.once('SIGCONT', done); try { proc.kill(0, 'SIGSTOP'); } catch { done(); } });
}
/** Is this job the one the terminal is showing? `bg` continues a job without giving it the terminal; drawing then would scribble over the shell. Linux reads /proc; elsewhere (or without a terminal) the answer is yes. */
export function isForeground(readStat: () => string = () => readFileSync('/proc/self/stat', 'utf8')): boolean {
  try { const t = readStat(); const f = t.slice(t.lastIndexOf(')') + 2).split(' '); /* state ppid pgrp session tty_nr tpgid */ const pgrp = Number(f[2]); const tpgid = Number(f[5]); return !Number.isFinite(pgrp) || !Number.isFinite(tpgid) || tpgid <= 0 || pgrp === tpgid; } catch { return true; }
}

/** After the job is continued: is the terminal handed to it? A shell may send the continue signal a moment before it hands the terminal over (`fg`), so a "no" is rechecked for a while before it is believed (`bg` never hands it over). */
export async function becomesForeground(waitMs = 1000, o: { isFg?: () => boolean; sleep?: (ms: number) => Promise<void>; now?: () => number } = {}): Promise<boolean> {
  const isFg = o.isFg ?? isForeground; const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms))); const now = o.now ?? Date.now; const end = now() + waitMs;
  for (;;) { if (isFg()) return true; if (now() >= end) return false; await sleep(40); }
}
