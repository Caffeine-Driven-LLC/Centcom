import { execFile } from 'node:child_process';

export interface GitResult { code: number; stdout: string; stderr: string }
export interface GitRunner { run(argv: string[], o: { cwd: string; timeoutMs: number; maxBytes: number; /** Added to the environment (the checkpoint code uses it for a temporary index and a fixed author). */ env?: Record<string, string> }): Promise<GitResult> }
export const GIT_ENV = { GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' } as const;

/** Real git, argv only, never a shell. The environment is the caller's plus the three hygiene variables; output is capped. */
export const nodeGit: GitRunner = {
  run: (argv, o) => new Promise((resolve) => {
    execFile('git', argv, { cwd: o.cwd, timeout: o.timeoutMs, maxBuffer: o.maxBytes, encoding: 'utf8', env: { ...process.env, ...(o.env ?? {}), ...GIT_ENV }, windowsHide: true }, (err, stdout, stderr) => {
      const e = err as (NodeJS.ErrnoException & { killed?: boolean; code?: number | string }) | null;
      if (!e) return resolve({ code: 0, stdout, stderr });
      if (e.killed) return resolve({ code: 124, stdout: stdout ?? '', stderr: 'timeout' });
      resolve({ code: typeof e.code === 'number' ? e.code : e.code === 'ENOENT' ? 127 : 1, stdout: stdout ?? '', stderr: stderr ?? String(e.message) });
    });
  }),
};
