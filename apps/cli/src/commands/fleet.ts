/** `centcom fleet start|list|stop|clean`. Everything it touches is injected. It never merges, pushes or deletes a branch. */
import { FleetError, type AgentId, type EngineId, type FleetManager, type FleetNode } from '@centcom/agent';

export interface FleetIO { fleet: FleetManager; repoRoot: string; ownerSlug: string; out(line: string): void; err(line: string): void }
export const FLEET_HELP = `centcom fleet start --count N --engine claude|codex --prompt <text> [--label <name>] [--base <ref>] [--model <name>]
centcom fleet list
centcom fleet stop <agent-id>|--all
centcom fleet clean            (lists worktrees left by an earlier run; removes nothing)`;
const ENG: Record<string, EngineId> = { claude: 'claude-code', 'claude-code': 'claude-code', codex: 'codex' };
const one = (a: string[], n: string) => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : undefined; };
const line = (n: FleetNode) => `${n.kind === 'subagent' ? '  └ ' : ''}${n.id.slice(0, 14)}  ${n.state.padEnd(8)} ${n.label}${n.branch ? `  ${n.branch}` : ''}${n.attention ? `  [${n.attention}]` : ''}${n.error_code ? `  (${n.error_code})` : ''}`;
export async function runFleet(argv: string[], io: FleetIO): Promise<number> {
  const [sub, ...rest] = argv;
  try {
    switch (sub) {
      case 'start': {
        const count = Number(one(rest, '--count') ?? 1); const engine = ENG[one(rest, '--engine') ?? 'claude']; const prompt = one(rest, '--prompt');
        if (!Number.isInteger(count) || count < 1 || count > 64) { io.err('--count is a whole number from 1 to 64.'); return 2; } if (!engine) { io.err('--engine is claude or codex.'); return 2; } if (!prompt) { io.err('Give the task with --prompt.'); return 2; }
        const label = one(rest, '--label'); let failed = 0;
        for (let i = 1; i <= count; i++) { try { const h = await io.fleet.spawn({ repoRoot: io.repoRoot, engine, prompt, ownerSlug: io.ownerSlug, ...(label ? { label: count > 1 ? `${label}-${i}` : label } : {}), ...(one(rest, '--base') ? { baseRef: one(rest, '--base')! } : {}), ...(one(rest, '--model') ? { model: one(rest, '--model')! } : {}) }); io.out(`${h.id}  ${h.state()}${h.branch ? `  ${h.branch}` : ''}`); } catch (e) { failed++; io.err(e instanceof FleetError ? e.message : `Could not start agent ${i}: ${String((e as Error)?.message ?? e).slice(0, 200)}`); if (e instanceof FleetError && (e.code === 'queue_full' || e.code === 'engine_paused')) break; } }
        return failed ? 1 : 0;
      }
      case 'list': { const l = io.fleet.list(); if (!l.length) io.out('No agents.'); for (const n of l) io.out(line(n)); for (const p of io.fleet.paused()) io.out(`! New ${p.engine} agents are paused: ${p.message}`); return 0; }
      case 'stop': { if (rest.includes('--all')) { await io.fleet.stopAll(); io.out('All agents stopped.'); return 0; } const id = rest.find((x) => !x.startsWith('--')); if (!id) { io.err('Usage: centcom fleet stop <agent-id> | --all'); return 2; } const full = io.fleet.list().find((n) => n.kind === 'agent' && (n.id === id || n.id.startsWith(id)))?.id; if (!full) { io.err('There is no such agent.'); return 2; } await io.fleet.stop(full as AgentId); io.out('Stopped.'); return 0; }
      case 'clean': { const orphans = await io.fleet.recoverOrphans(io.repoRoot); if (!orphans.length) io.out('Nothing left over.'); for (const w of orphans) io.out(`${w.agentId}  ${w.branch}  ${w.path}${w.missing ? '  (folder is gone)' : ''}`); if (orphans.length) io.out('Nothing was removed. Remove one yourself with `git worktree remove` once you have checked it for unsaved work.'); return 0; }
      default: io.err(FLEET_HELP); return sub ? 2 : 0;
    }
  } catch (e) { io.err(e instanceof FleetError ? e.message : 'Something went wrong.'); return 1; }
}
