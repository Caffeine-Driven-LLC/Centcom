import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { ApprovalBridge, BudgetGuard, buildArgv, captureTurns, flagValues, ClaudeStreamParser, SUBAGENT_TOOLS } from '../../src/index.js';

const bridges: ApprovalBridge[] = []; afterEach(() => { for (const b of bridges.splice(0)) b.close(); });
const gate = { decide: async () => ({ decision: 'deny' as const, scope: 'once' as const }) };
async function make(guard: BudgetGuard) { const b = new ApprovalBridge({ agentId: 'a', cwd: '/w', gate, emit: () => undefined, subagentGate: () => guard.allowSubagent() }); bridges.push(b); await b.start(); return b; }
/** Runs the hook exactly as Claude Code would: the command from the settings file, the tool call on standard input. */
function runHook(settingsPath: string, saved?: string): Promise<{ out: string; code: number | null }> {
  const s = JSON.parse(saved ?? readFileSync(settingsPath, 'utf8')); const h = s.hooks.PreToolUse[0].hooks[0];
  return new Promise((res) => { // asynchronous: the bridge answers from this same process
    const c = spawn('sh', ['-c', h.command]); let out = ''; c.stdout.setEncoding('utf8'); c.stdout.on('data', (d: string) => { out += d; }); c.on('close', (code) => res({ out, code }));
    c.stdin.end(JSON.stringify({ tool_name: 'Task', tool_input: { prompt: 'x' } }));
  });
}

describe('the sub-agent limit, enforced through a Claude Code hook', () => {
  it('adds a PreToolUse hook for the sub-agent tools to the launch flags', async () => {
    const b = await make(new BudgetGuard({ maxSubagents: 1 })); const argv = b.argv();
    expect(flagValues(argv, '--settings')).toHaveLength(1); const s = JSON.parse(readFileSync(b.settingsPath!, 'utf8'));
    expect(s.hooks.PreToolUse[0].matcher).toBe(SUBAGENT_TOOLS.join('|')); expect(s.hooks.PreToolUse[0].hooks[0].type).toBe('command');
  });
  it('lets the first sub-agent start (prints nothing) and refuses the one over the limit with the reason', async () => {
    const guard = new BudgetGuard({ maxSubagents: 1 }); const b = await make(guard);
    const first = await runHook(b.settingsPath!); expect(first.code).toBe(0); expect(first.out).toBe('');
    const second = await runHook(b.settingsPath!); expect(second.code).toBe(0); const j = JSON.parse(second.out);
    expect(j.hookSpecificOutput).toMatchObject({ hookEventName: 'PreToolUse', permissionDecision: 'deny' }); expect(j.hookSpecificOutput.permissionDecisionReason).toContain('limit for this run is reached (1)');
    expect(guard.meter().run.subagents).toBe(1);
  });
  it('a new run starts counting again', async () => {
    const guard = new BudgetGuard({ maxSubagents: 1 }); const b = await make(guard); await runHook(b.settingsPath!); expect((await runHook(b.settingsPath!)).out).not.toBe(''); guard.startRun('task'); expect((await runHook(b.settingsPath!)).out).toBe('');
  });
  it('does not stop the work when Centcom cannot be reached', async () => {
    const guard = new BudgetGuard({ maxSubagents: 0 }); const b = await make(guard); const saved = readFileSync(b.settingsPath!, 'utf8'); b.close(); bridges.length = 0;
    const r = await runHook('', saved); expect(r.code).toBe(0); expect(r.out).toBe('');
  });
  it('no bridge hook without a gate, and zero sub-agents removes the tool from the launch instead', async () => {
    const b = new ApprovalBridge({ agentId: 'a', cwd: '/w', gate, emit: () => undefined }); bridges.push(b); await b.start(); expect(b.argv()).not.toContain('--settings');
    expect(flagValues(buildArgv('p', { disallowedTools: [...SUBAGENT_TOOLS] }), '--disallowedTools')).toEqual(['Agent', 'Task']);
  });
  it('the engine wires the gate into every turn and caps a turn by the cost still allowed', async () => {
    const guard = new BudgetGuard({ maxSubagents: 3 });
    const cap = await captureTurns(['a', 'b'], { approvalGate: gate, subagentGate: () => guard.allowSubagent() });
    for (const a of cap.argv) expect(flagValues(a, '--settings')).toHaveLength(1);
    expect(buildArgv('p', { maxBudgetUsd: 3.456 })).toEqual(expect.arrayContaining(['--max-budget-usd', '3.46']));
  });
});

describe('the engine reports every request as it finishes', () => {
  const ev = (o: object) => JSON.stringify({ type: 'stream_event', session_id: 's', ...o });
  it('emits usage.progress for the main conversation and for sub-agents, each with its own usage', () => {
    const p = new ClaudeStreamParser(); const out = [] as { type: string; scope?: string; output_tokens?: number }[];
    const feed = (parent: string | null, id: string, outTok: number) => {
      out.push(...p.push(ev({ parent_tool_use_id: parent, event: { type: 'message_start', message: { id, usage: { input_tokens: 3, cache_creation_input_tokens: 7, cache_read_input_tokens: 100, output_tokens: 1 } } } })));
      out.push(...p.push(ev({ parent_tool_use_id: parent, event: { type: 'message_delta', delta: {}, usage: { output_tokens: outTok } } }))); out.push(...p.push(ev({ parent_tool_use_id: parent, event: { type: 'message_stop' } })));
    };
    feed(null, 'm1', 40); feed('toolu_1', 's1', 900);
    const prog = out.filter((e) => e.type === 'usage.progress'); expect(prog).toMatchObject([{ scope: 'main', output_tokens: 40, input_tokens: 10, cache_read_tokens: 100 }, { scope: 'subagent', output_tokens: 900 }]);
  });
  it('keeps two sub-agents that stream at the same time apart', () => {
    const p = new ClaudeStreamParser(); const out = [] as { type: string; output_tokens?: number }[];
    const e = (parent: string, event: object) => out.push(...p.push(ev({ parent_tool_use_id: parent, event })));
    e('A', { type: 'message_start', message: { id: 'a', usage: {} } }); e('B', { type: 'message_start', message: { id: 'b', usage: {} } });
    e('A', { type: 'message_delta', delta: {}, usage: { output_tokens: 11 } }); e('B', { type: 'message_delta', delta: {}, usage: { output_tokens: 22 } }); e('A', { type: 'message_stop' }); e('B', { type: 'message_stop' });
    expect(out.filter((x) => x.type === 'usage.progress').map((x) => x.output_tokens)).toEqual([11, 22]);
  });
});
