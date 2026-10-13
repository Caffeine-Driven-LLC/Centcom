/** The two doors the update code goes through to touch the outside world: files and a child process. Tests pass fakes (with faults); the program passes the real ones.
 *  Must not: read the network, use a shell, or put a path in an error message. */
import { spawn } from 'node:child_process';
import { chmod, copyFile, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';

export interface FsPort {
  exists(path: string): Promise<boolean>;
  copyFile(from: string, to: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  rm(path: string): Promise<void>;
  chmod(path: string, mode: number): Promise<void>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, data: string): Promise<void>;
}
export interface RunResult { code: number | null; stdout: string; timedOut: boolean }
export interface Runner { run(file: string, args: string[], o: { timeoutMs: number }): Promise<RunResult> }

export const nodeFs: FsPort = {
  exists: async (p) => { try { await stat(p); return true; } catch { return false; } },
  copyFile: (a, b) => copyFile(a, b),
  rename: (a, b) => rename(a, b),
  rm: (p) => rm(p, { force: true }),
  chmod: (p, m) => chmod(p, m),
  readFile: (p) => readFile(p, 'utf8'),
  writeFile: (p, d) => writeFile(p, d, 'utf8'),
};

/** Runs a program with no shell and no terminal; stops it after `timeoutMs`. Output is capped at 64 KiB. */
export const nodeRunner: Runner = {
  run: (file, args, o) => new Promise((resolve) => {
    let out = ''; let timedOut = false; let done = false;
    const end = (code: number | null) => { if (done) return; done = true; clearTimeout(t); resolve({ code, stdout: out, timedOut }); };
    let child: ReturnType<typeof spawn>;
    try { child = spawn(file, args, { stdio: ['ignore', 'pipe', 'ignore'], shell: false }); } catch { resolve({ code: null, stdout: '', timedOut: false }); return; }
    const t = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, o.timeoutMs); t.unref();
    child.stdout?.on('data', (c: Buffer) => { if (out.length < 65_536) out += c.toString('utf8'); });
    child.on('error', () => end(null)); child.on('close', (code) => end(code));
  }),
};
