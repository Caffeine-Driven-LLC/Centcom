/** Child process for refresh-lock.test.ts: take the lock, log enter/exit around a short hold, release. Args: <lockDir> <logFile> <holdMs>. */
import { appendFileSync } from 'node:fs';
import { acquireRefreshLock } from '../../../src/auth/refresh-lock.js';

const [dir, log, hold] = process.argv.slice(2) as [string, string, string];
const h = await acquireRefreshLock(dir, { acquireTimeoutMs: 20_000 });
appendFileSync(log, `enter ${process.pid}\n`);
await new Promise((r) => setTimeout(r, Number(hold)));
appendFileSync(log, `exit ${process.pid}\n`);
await h.release();
