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

/** Stop this process until the shell continues it (`fg`). Resolves when it is running again. */
export function stopUntilContinued(proc: Pick<NodeJS.Process, 'pid' | 'kill' | 'once'> = process): Promise<void> {
  return new Promise((resolve) => { proc.once('SIGCONT', () => resolve()); try { proc.kill(proc.pid, 'SIGSTOP'); } catch { resolve(); } });
}
