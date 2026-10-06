import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { VirtualClock } from '@centcom/testkit';
import { createPermissionGate, type ApprovalPrompter, type NormalisedEvent, type PendingApproval } from '../../src/index.js';
import { createFakeEngine, loadTranscript } from '../../src/engine/testing/index.js';
import { req, rig, tick } from './helpers.js';


const FX = fileURLToPath(new URL('../fixtures/transcripts/', import.meta.url));

describe('engine independence', () => {
  it('a Claude-style and a Codex-style approval for the same edit give the same pending shape and the same decision', async () => {
    const claude = req({ approval_id: 'apr_01JTEST0000000000000000001', tool: 'Edit', path: 'src/a.ts', command: undefined, summary: 'Edit src/a.ts', risk: 'medium' });
    const codex = req({ approval_id: 'apr_01JTEST0000000000000000002', tool: 'apply_patch', path: 'src/a.ts', command: undefined, summary: 'Apply patch to src/a.ts', risk: 'medium' });
    const out: { decision: unknown; shape: string[] }[] = [];
    for (const [r0, engine] of [[claude, 'claude-code'], [codex, 'codex']] as const) { const seen: PendingApproval[] = []; const p: ApprovalPrompter = { prompt: async (x) => { seen.push(x); return { decision: 'approve', scope: 'once' }; } }; const r = rig({ prompter: p }); const dec = await r.engine.decide(r0, { ...r.ctx, engine }); const ans = await r.engine.handle(r0, { ...r.ctx, engine }); out.push({ decision: { action: dec.action, reason: dec.reason }, shape: Object.keys(seen[0]!).sort() }); expect(ans).toMatchObject({ decision: 'approve' }); }
    expect(out[1]).toEqual(out[0]); expect(out[0]!.decision).toEqual({ action: 'ask', reason: 'mode' });
  });
  it('shell commands the two engines word differently (Bash vs shell) are both shell: they ask, and a `git status:*` rule allows both', async () => {
    const r = rig(); for (const tool of ['Bash', 'shell', 'local_shell']) expect((await r.engine.decide(req({ tool }), { ...r.ctx, engine: tool === 'Bash' ? 'claude-code' : 'codex' })).action, tool).toBe('ask');
    await r.rules.add({ tool: 'Bash', action: 'allow', scope: 'session', matcher: { command: 'git status:*' } }); await r.rules.add({ tool: 'shell', action: 'allow', scope: 'session', matcher: { command: 'git status:*' } }); for (const tool of ['Bash', 'shell']) expect((await r.engine.decide(req({ tool }), { ...r.ctx, engine: 'claude-code' })).action, tool).toBe('allow');
  });
  it('the approval transcript runs through the real broker as an engine would use it: ask, answer, continue', async () => {
    const t = loadTranscript(join(FX, 'approval.transcript.jsonl')); const seen: PendingApproval[] = []; const r = rig({ prompter: { prompt: async (p) => { seen.push(p); return { decision: 'approve', scope: 'once' }; } } });
    const gate = createPermissionGate(r.engine, () => ({ ...r.ctx, engine: 'fake' })); const eng = createFakeEngine(t, { clock: new VirtualClock() }); const s = (await eng.start({ agentId: r.ctx.agentId, cwd: r.root, approvalGate: gate })) as unknown as { send(p: string): Promise<unknown>; events: AsyncIterable<NormalisedEvent>; finished: Promise<void>; failure?: Error };
    const evs: NormalisedEvent[] = []; void (async () => { for await (const e of s.events) evs.push(e); })(); await s.send('fix the typo'); await s.finished; await tick();
    expect(s.failure).toBeUndefined(); expect(seen).toHaveLength(1); expect(seen[0]).toMatchObject({ tool: 'tool', risk: 'medium' }); expect(evs.find((e) => e.type === 'approval.resolved')).toMatchObject({ decision: 'approve', by: 'user' }); expect(evs.at(-1)!.type).toBe('turn.done');
  });
  it('a gate decision for a deny-by-rule never reaches a person', async () => {
    const seen: PendingApproval[] = []; const r = rig({ prompter: { prompt: async (p) => { seen.push(p); return { decision: 'approve', scope: 'once' }; } } }); await r.rules.add({ tool: 'Bash', action: 'deny', scope: 'session', matcher: { command: 'rm:*' } });
    const gate = createPermissionGate(r.engine, () => r.ctx); expect(await gate.decide(req({ command: 'rm -rf build' }))).toMatchObject({ decision: 'deny' }); expect(seen).toEqual([]);
  });
});
