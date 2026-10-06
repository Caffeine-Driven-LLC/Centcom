/** The real process boundary for probes: no shell, no stdin, bounded output and time. Everything else is injected so tests never start a process. */
import { spawn } from 'node:child_process';
import { delimiter, extname, isAbsolute, join } from 'node:path';
import { statSync } from 'node:fs';

export interface RunResult { code: number | null; out: string; missing: boolean; timedOut: boolean; tooLong: boolean }
export type RunFn = (file: string, args: string[], o: { timeoutMs: number; maxBytes: number }) => Promise<RunResult>;
export type WhichFn = (name: string) => string | undefined;

export const runProbe: RunFn = (file, args, o) => new Promise((resolve) => {
  let out = ''; let done = false; let timedOut = false; let tooLong = false;
  const finish = (code: number | null, missing = false) => { if (done) return; done = true; clearTimeout(timer); resolve({ code, out: out.slice(0, 4096), missing, timedOut, tooLong }); };
  let child: ReturnType<typeof spawn>; const timer: NodeJS.Timeout = setTimeout(() => { timedOut = true; try { child?.kill('SIGKILL'); } catch { /* gone */ } finish(null); }, o.timeoutMs); timer.unref();
  try { child = spawn(file, args, { stdio: ['ignore', 'pipe', 'pipe'], shell: false }); } catch (e) { return finish(null, (e as NodeJS.ErrnoException).code === 'ENOENT'); }
  let bytes = 0; const take = (d: Buffer) => { bytes += d.length; if (out.length < 4096) out += d.toString('utf8'); if (bytes > o.maxBytes && !tooLong) { tooLong = true; try { child.kill('SIGKILL'); } catch { /* gone */ } } };
  child.stdout?.on('data', take); child.stderr?.on('data', take);
  child.on('error', (e: NodeJS.ErrnoException) => finish(null, e.code === 'ENOENT')); child.on('close', (code) => finish(code));
});

/** Looks a command up on PATH by statting directories only. Relative or missing PATH entries and directories are skipped. Never reads a file. */
export function makeWhich(env: Record<string, string | undefined> = process.env, os: NodeJS.Platform = process.platform): WhichFn {
  const exts = os === 'win32' ? (env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';') : [''];
  const isFile = (p: string) => { try { return statSync(p).isFile(); } catch { return false; } };
  return (name) => {
    if (isAbsolute(name)) return isFile(name) ? name : undefined;
    for (const dir of (env.PATH ?? '').split(delimiter)) { if (!dir || !isAbsolute(dir)) continue; for (const x of exts) { const p = join(dir, extname(name) ? name : name + x); if (isFile(p)) return p; } }
    return undefined;
  };
}
