/**
 * LIVE CHECK of the sub-agent limit and the per-request meter against the real `claude` on this machine. One tiny request on Haiku
 * (a few cents): it asks for two sub-agents with a limit of one, and prints what the hook allowed, what it refused, and the usage events.
 *
 *     pnpm exec tsx tools/dev/cost-live.ts
 *
 * Exit code 0 when exactly one sub-agent was started and the second was refused with Centcom's reason.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BudgetGuard, ClaudeCodeEngine, type NormalisedEvent } from '../../packages/agent/src/index.js';

const guard = new BudgetGuard({ maxSubagents: 1 });
const engine = new ClaudeCodeEngine();
const s = await engine.start({ agentId: 'agt_live', cwd: mkdtempSync(join(tmpdir(), 'cost-live-')), model: 'haiku', permissionMode: 'bypassPermissions', allowBypass: true,
  approvalGate: { decide: async () => ({ decision: 'approve', scope: 'once' }) }, subagentGate: () => guard.allowSubagent() });
await s.send('Call the Agent tool twice, one after the other, each with the prompt "reply ok". Then say done.');
const evs: NormalisedEvent[] = [];
for await (const ev of s.events) { evs.push(ev); if (ev.type === 'turn.done') break; }
await s.stop();
const started = evs.filter((e) => e.type === 'subagent.started').length;
const refused = evs.filter((e) => e.type === 'tool.result' && (e.status === 'denied' || e.status === 'error') && /sub-agent limit/i.test(e.summary)).length;
const progress = evs.filter((e) => e.type === 'usage.progress');
console.log(JSON.stringify({ subagents_started: started, refused_by_limit: refused, allowed_by_gate: guard.meter().run.subagents, usage_progress_events: progress.length, main: progress.filter((e) => e.type === 'usage.progress' && e.scope === 'main').length, sub: progress.filter((e) => e.type === 'usage.progress' && e.scope === 'subagent').length }));
process.exit(guard.meter().run.subagents === 1 && refused >= 1 ? 0 : 1);
