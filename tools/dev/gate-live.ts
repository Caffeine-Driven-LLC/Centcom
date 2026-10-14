/**
 * `pnpm exec tsx tools/dev/gate-live.ts`: gate G1 (device-flow sign-in, then `GET /v1/me`) against the LOCAL backend instead of the mock, with the device
 * approved the way a person would (`approveDevice` signs a brand-new account in through the browser page's own endpoints). Needs the backend repo's dev stack
 * (`pnpm dev:up`, `pnpm dev:api`). Exit 0 only when every step of G1 passed.
 */
import { runGate } from '../gates/run.js';
import { api, approveDevice, freshEmail } from './live-browser.js';

const email = freshEmail('gate'); const pending: Promise<unknown>[] = [];
const report = await runGate('G1', { backend: api, announce: (code) => { pending.push(approveDevice(code, email)); } });
await Promise.all(pending);
for (const s of report.steps) console.log(`${s.status === 'pass' ? 'ok  ' : 'FAIL'} ${s.id}${s.evidence ? ` (${s.evidence})` : ''} ${s.duration_ms} ms`);
console.log(report.passed ? `\nG1 passed against ${api}` : '\nG1 NOT passed'); process.exit(report.passed ? 0 : 1);
