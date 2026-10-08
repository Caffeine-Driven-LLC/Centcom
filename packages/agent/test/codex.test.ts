import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CodexEngine, CodexMapper, diffFor, errorCodeFor, policyFor, type ApprovalRequest, type NormalisedEvent } from '../src/index.js';

const FAKE = fileURLToPath(new URL('./fixtures/fake-codex.mjs', import.meta.url));
const fakeSpawn = ((_bin: string, _args: string[], o: any) => spawn(process.execPath, [FAKE], { ...o })) as any;

async function until(events: NormalisedEvent[], pred: (e: NormalisedEvent) => boolean, ms = 5000) {
  const t0 = Date.now(); while (Date.now() - t0 < ms) { if (events.some(pred)) return; await new Promise((r) => setTimeout(r, 15)); }
  throw new Error('timed out; saw: ' + events.map((e) => e.type).join(','));
}
async function session(opts: { signedIn?: boolean; gate?: (r: ApprovalRequest) => Promise<any>; mode?: any } = {}) {
  const engine = new CodexEngine({ spawn: fakeSpawn, env: { FAKE_CODEX_SIGNED_IN: opts.signedIn === false ? '0' : '1' } });
  const s = await engine.start({ agentId: 'a1', cwd: '/tmp', permissionMode: opts.mode, approvalGate: opts.gate ? { decide: opts.gate } : undefined });
  const events: NormalisedEvent[] = []; void (async () => { for await (const e of s.events) events.push(e); })();
  return { s, events };
}

describe('codex mapping', () => {
  it('maps permission modes to approval policy and sandbox', () => {
    expect(policyFor('default')).toEqual({ approvalPolicy: 'untrusted', sandboxPolicy: { type: 'workspaceWrite' } });
    expect(policyFor('plan').sandboxPolicy.type).toBe('readOnly'); expect(policyFor('bypassPermissions').approvalPolicy).toBe('never');
  });
  it('turns patches into diffs whatever form they arrive in', () => {
    expect(diffFor([{ path: 'a.txt', kind: { type: 'add' }, diff: 'hi' }])).toContain('+hi');
    expect(diffFor([{ path: 'a.ts', kind: { type: 'update' }, diff: '@@ -1 +1 @@\n-a\n+b' }])).toMatch(/^--- a\/a\.ts\n\+\+\+ b\/a\.ts\n@@/);
    expect(diffFor([{ path: 'a.ts', kind: { type: 'update' }, diff: '--- a/a.ts\n+++ b/a.ts\n@@\n-a\n+b' }]).match(/---/g)).toHaveLength(1);
  });
  it('classifies errors', () => { expect(errorCodeFor('401 Unauthorized')).toBe('provider_not_signed_in'); expect(errorCodeFor('You exceeded your usage limit')).toBe('provider_cap_reached'); expect(errorCodeFor('429 too many requests')).toBe('provider_rate_limited'); expect(errorCodeFor('boom')).toBe('provider_protocol_error'); });
  it('maps commands, results, limits and usage', () => {
    const m = new CodexMapper();
    const started = m.notification('item/started', { item: { type: 'commandExecution', id: 'c', command: 'rm -rf build' } });
    expect(started.find((e) => e.type === 'tool.requested')).toMatchObject({ name: 'Bash', risk: 'high', command: 'rm -rf build' });
    expect(m.notification('item/completed', { item: { type: 'commandExecution', id: 'c', status: 'completed', exitCode: 2, aggregatedOutput: 'bad' } })[0]).toMatchObject({ type: 'tool.result', status: 'error' });
    expect(m.notification('account/rateLimits/updated', { rateLimits: { primary: { usedPercent: 50, windowDurationMins: 300, resetsAt: 9 } } })[0]).toEqual({ type: 'limits.report', windows: [{ name: 'five_hour', utilization: 0.5, resets_at: 9 }] });
    expect(m.notification('thread/tokenUsage/updated', { tokenUsage: { last: { inputTokens: 5, outputTokens: 2, totalTokens: 7 }, total: { totalTokens: 50 }, modelContextWindow: 100 } })[0]).toMatchObject({ input_tokens: 5, context_used_pct: 7, context_tokens: 7 }); /* total is cumulative: the gauge uses last */
  });
});

describe('codex engine against a protocol-faithful fake app-server', () => {
  it('streams a plain turn', async () => {
    const { s, events } = await session(); await s.send('hello'); await until(events, (e) => e.type === 'turn.done');
    expect(events[0]).toMatchObject({ type: 'session.started', engine: 'codex', model: 'gpt-fake', login_kind: 'subscription' });
    expect(events.filter((e) => e.type === 'text.delta').map((e: any) => e.text).join('')).toBe('Hello from Codex.');
    expect(events.find((e) => e.type === 'text.done')).toMatchObject({ text: 'Hello from Codex.' });
    expect(events.find((e) => e.type === 'thinking.delta')).toBeTruthy(); expect(events.find((e) => e.type === 'usage.report')).toMatchObject({ input_tokens: 100, context_used_pct: 10 });
    expect(events.find((e) => e.type === 'limits.report')).toBeTruthy(); expect(events.at(-1)).toMatchObject({ type: 'turn.done', outcome: 'ok' });
    await s.stop();
  });
  it('asks the gate before a file change and sends accept', async () => {
    const seen: ApprovalRequest[] = []; const { s, events } = await session({ gate: async (r) => { seen.push(r); return { decision: 'approve', scope: 'once' }; } });
    await s.send('please edit a.ts'); await until(events, (e) => e.type === 'turn.done');
    expect(seen[0]).toMatchObject({ tool: 'Edit', path: 'src/a.ts', tool_id: 'fc1' }); expect(seen[0]!.diff).toContain('+const a = 2;');
    expect(events.find((e) => e.type === 'tool.result')).toMatchObject({ status: 'ok' }); await s.stop();
  });
  it('declines when the user says no, and the turn still ends cleanly', async () => {
    const { s, events } = await session({ gate: async () => ({ decision: 'deny', scope: 'once' }) });
    await s.send('run the tests'); await until(events, (e) => e.type === 'turn.done');
    expect(events.find((e) => e.type === 'tool.result')).toMatchObject({ tool_id: 'c1', status: 'denied' });
    expect(events.find((e) => e.type === 'approval.resolved')).toMatchObject({ decision: 'deny' }); await s.stop();
  });
  it('denies when there is no gate at all', async () => {
    const { s, events } = await session(); await s.send('run it'); await until(events, (e) => e.type === 'turn.done');
    expect(events.find((e) => e.type === 'tool.result')).toMatchObject({ status: 'denied' }); await s.stop();
  });
  it('reports not-signed-in without calling the model', async () => {
    const { s, events } = await session({ signedIn: false }); await s.send('hello'); await until(events, (e) => e.type === 'turn.done');
    expect(events.find((e) => e.type === 'error')).toMatchObject({ code: 'provider_not_signed_in', fatal: true }); expect(events.at(-1)).toMatchObject({ outcome: 'error' }); await s.stop();
  });
  it('surfaces a failed turn as an error', async () => {
    const { s, events } = await session(); await s.send('fail please'); await until(events, (e) => e.type === 'turn.done');
    expect(events.find((e) => e.type === 'error')).toMatchObject({ code: 'provider_not_signed_in' }); expect(events.at(-1)).toMatchObject({ outcome: 'error' }); await s.stop();
  });
  it('interrupts a running turn', async () => {
    const { s, events } = await session(); await s.send('slow one'); await new Promise((r) => setTimeout(r, 150));
    expect((await s.interrupt()).stopped).toBe(true); await until(events, (e) => e.type === 'turn.done');
    expect(events.at(-1)).toMatchObject({ outcome: 'canceled' }); await s.stop();
  });
  it('lists non-hidden models', async () => { const { s } = await session(); expect(await (s as any).listModels()).toEqual([{ id: 'gpt-fake', label: 'GPT Fake', note: 'for tests', provider: 'openai' }]); await s.stop(); });
  it('reports a missing install clearly', async () => {
    const engine = new CodexEngine({ bin: '/definitely/not/codex' }); const s = await engine.start({ agentId: 'a', cwd: '/' });
    const events: NormalisedEvent[] = []; void (async () => { for await (const e of s.events) events.push(e); })(); await until(events, (e) => e.type === 'error');
    expect(events.find((e) => e.type === 'error')).toMatchObject({ code: 'provider_not_installed' }); await s.stop();
  });
});
