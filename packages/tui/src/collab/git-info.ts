/** What a teammate sees of a branch: its name, the head, and how far it is from the base. Read from git, never from the files. */
import { execFile } from 'node:child_process';

export interface BranchInfo { branch: string; head: string; ahead: number; behind: number; dirty: boolean }
export type BranchProbe = (cwd: string) => Promise<BranchInfo | undefined>;

const git = (cwd: string, args: string[]): Promise<string | undefined> => new Promise((resolve) => { execFile('git', args, { cwd, timeout: 4000, maxBuffer: 1 << 20 }, (err, out) => resolve(err ? undefined : String(out).trim())); });

/** The branch of `cwd`, its short head, whether the tree has changes, and ahead/behind against its upstream (or the default branch when there is no upstream). */
export const gitBranchInfo: BranchProbe = async (cwd) => {
  const branch = (await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])) ?? (await git(cwd, ['symbolic-ref', '--short', 'HEAD'])); if (!branch) return undefined; // a new repository with no commit yet has a branch name but no HEAD to resolve
  const head = (await git(cwd, ['rev-parse', '--short', 'HEAD'])) ?? ''; const status = (await git(cwd, ['status', '--porcelain'])) ?? '';
  let base = await git(cwd, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']);
  if (!base) { for (const c of ['origin/main', 'origin/master', 'main', 'master']) { if (c !== branch && (await git(cwd, ['rev-parse', '--verify', '--quiet', c]))) { base = c; break; } } }
  let ahead = 0; let behind = 0;
  if (base) { const counts = await git(cwd, ['rev-list', '--left-right', '--count', `${base}...HEAD`]); const m = counts ? /^(\d+)\s+(\d+)$/.exec(counts) : null; if (m) { behind = Number(m[1]); ahead = Number(m[2]); } }
  return { branch, head, ahead, behind, dirty: status.length > 0 };
};
