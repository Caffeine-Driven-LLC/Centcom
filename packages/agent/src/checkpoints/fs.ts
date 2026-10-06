import { access, copyFile, lstat, rm, rmdir, stat, utimes } from 'node:fs/promises';
import type { CheckpointFs } from './types.js';

export const nodeCheckpointFs: CheckpointFs = {
  // Keep the source mtime: git's racy-stat check compares file mtimes with the index file's mtime, so a fresh mtime on the copy would let a same-size rewrite in the same clock tick look unchanged.
  copyFile: async (a, b) => { await copyFile(a, b); const s = await stat(a); await utimes(b, s.atime, s.mtime); },
  rm: (p) => rm(p, { force: true }),
  exists: (p) => access(p).then(() => true, () => false),
  lstatIsDir: (p) => lstat(p).then((s) => s.isDirectory(), () => undefined),
  rmdirIfEmpty: (p) => rmdir(p).catch(() => undefined),
};
