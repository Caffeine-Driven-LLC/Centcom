import { access, copyFile, lstat, rm, rmdir } from 'node:fs/promises';
import type { CheckpointFs } from './types.js';

export const nodeCheckpointFs: CheckpointFs = {
  copyFile: (a, b) => copyFile(a, b),
  rm: (p) => rm(p, { force: true }),
  exists: (p) => access(p).then(() => true, () => false),
  lstatIsDir: (p) => lstat(p).then((s) => s.isDirectory(), () => undefined),
  rmdirIfEmpty: (p) => rmdir(p).catch(() => undefined),
};
