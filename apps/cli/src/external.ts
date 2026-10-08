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
  return new Promise((resolve) => { proc.once('SIGCONT', () => resolve()); try { proc.kill(0, 'SIGSTOP'); } catch { resolve(); } });
}
/** Is this job the one the terminal is showing? `bg` continues a job without giving it the terminal; drawing then would scribble over the shell. Linux reads /proc; elsewhere (or without a terminal) the answer is yes. */
export function isForeground(readStat: () => string = () => readFileSync('/proc/self/stat', 'utf8')): boolean {
  try { const t = readStat(); const f = t.slice(t.lastIndexOf(')') + 2).split(' '); /* state ppid pgrp session tty_nr tpgid */ const pgrp = Number(f[2]); const tpgid = Number(f[5]); return !Number.isFinite(pgrp) || !Number.isFinite(tpgid) || tpgid <= 0 || pgrp === tpgid; } catch { return true; }
}
