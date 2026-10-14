/** LIVE CHECK of the interrupt receipt (C030) and the version check (C102) against the real `claude` on this machine. It sends one short prompt, stops the turn after the first words, and prints how the engine stopped it.
 *
 *     pnpm exec tsx tools/dev/claude-interrupt-live.ts
 *
 * Needs `claude` signed in (it makes one small request, then interrupts it). Exit code 0 when the CLI confirmed the interrupt (`method: protocol`, `receipt: true`) and the turn ended as cancelled with no error. */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ClaudeCodeEngine, claudeVersionProbe, createProcessRegistry, type NormalisedEvent } from '../../packages/agent/src/index.js';

const procs = createProcessRegistry();
const engine = new ClaudeCodeEngine({ procs, versionProbe: claudeVersionProbe() });
const s = await engine.start({ agentId: 'agt_live', cwd: mkdtempSync(join(tmpdir(), 'claude-live-')), model: 'haiku', permissionMode: 'plan' });
const seen: NormalisedEvent[] = [];
await s.send('Count from 1 to 60, one number per line, nothing else.');
let stopped: Awaited<ReturnType<typeof s.interrupt>> | undefined; const t0 = Date.now();
for await (const e of s.events) {
  seen.push(e);
  if (e.type === 'text.delta' && !stopped) stopped = await s.interrupt();
  if (e.type === 'turn.done') break;
}
await s.stop?.();
const done = seen.at(-1); const errors = seen.filter((e) => e.type === 'error');
console.log(JSON.stringify({ interrupt: stopped, ms: Date.now() - t0, outcome: done && done.type === 'turn.done' ? done.outcome : undefined, errors: errors.length, events: seen.length }));
const ok = stopped?.method === 'protocol' && stopped.receipt === true && done?.type === 'turn.done' && done.outcome === 'canceled' && errors.length === 0;
console.log(ok ? 'ok: the CLI confirmed the interrupt' : 'NOT confirmed by a receipt');
process.exit(ok ? 0 : 1);
