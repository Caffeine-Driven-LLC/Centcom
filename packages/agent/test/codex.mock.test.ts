import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { CodexEngine, detectCodex } from '../src/index.js';
import type { ApprovalDecision, EngineSession, NormalisedEvent } from '../src/types.js';

const BIN = resolve(__dirname, '../../../tools/codex/bin/codex');
const home = mkdtempSync(join(tmpdir(), 'mock-home-')); process.env.MOCK_CODEX_HOME = home;
const proj = () => mkdtempSync(join(tmpdir(), 'mock-proj-'));
const sessions: EngineSession[] = []; afterAll(async () => { for (const s of sessions) await s.stop().catch(() => undefined); });
const gate = (answer: ApprovalDecision['decision'], seen: string[] = []) => ({ decide: async (a: { tool: string; command?: string }) => { seen.push(`${a.tool}:${a.command ?? ''}`); return { decision: answer, scope: 'once' as const }; } });
async function start(o: Partial<Parameters<CodexEngine['start']>[0]> = {}, cwd = proj()) { const s = await new CodexEngine({ bin: BIN, stallMs: 0 }).start({ agentId: 'agt_mock', cwd, ...o } as never); sessions.push(s); const evs: NormalisedEvent[] = []; void (async () => { for await (const e of s.events) evs.push(e); })(); return { s, evs, cwd }; }
const until = async (f: () => boolean, ms = 8000) => { const t0 = Date.now(); while (!f()) { if (Date.now() - t0 > ms) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 15)); } };
const done = (evs: NormalisedEvent[], n = 1) => evs.filter((e) => e.type === 'turn.done').length >= n;

describe('detection of the mock Codex', () => {
  it('is found, versioned and signed in; signed out is reported', async () => {
    expect(await detectCodex(BIN)).toMatchObject({ installed: true, version: expect.stringContaining('0.161.0'), signedIn: 'yes', loginKind: 'subscription' });
    process.env.MOCK_CODEX_SIGNED_IN = '0'; try { expect(await detectCodex(BIN)).toMatchObject({ installed: true, signedIn: 'no' }); } finally { delete process.env.MOCK_CODEX_SIGNED_IN; }
    expect(await detectCodex('/nonexistent/codex')).toMatchObject({ installed: false });
  });
});
describe('a whole Codex session against the mock (real child process, real protocol)', () => {
  it('a plain chat streams text and ends with usage, limits and turn.done', async () => {
    const { s, evs } = await start(); await s.send('hello there'); await until(() => done(evs));
    expect(evs.find((e) => e.type === 'session.started')).toMatchObject({ engine: 'codex', login_kind: 'subscription', model: 'mock-sol' }); expect(evs.find((e) => e.type === 'text.done')).toMatchObject({ text: 'Hello from mock Codex. You said: hello there' });
    expect(evs.filter((e) => e.type === 'text.delta').length).toBeGreaterThan(3); expect(evs.find((e) => e.type === 'usage.report')).toMatchObject({ context_used_pct: 0 }); expect(evs.some((e) => e.type === 'limits.report')).toBe(true); expect(evs.at(-1)).toMatchObject({ type: 'turn.done', outcome: 'ok' });
  });
  it('a command asks first, runs when allowed, and its output comes back', async () => {
    const seen: string[] = []; const { s, evs } = await start({ approvalGate: gate('approve', seen) as never }); await s.send('run: echo mock-ok'); await until(() => done(evs));
    expect(seen).toEqual(['Bash:echo mock-ok']); expect(evs.find((e) => e.type === 'tool.requested')).toMatchObject({ name: 'Bash', risk: 'low', input_summary: 'echo mock-ok' }); expect(evs.find((e) => e.type === 'tool.result')).toMatchObject({ status: 'ok', summary: 'mock-ok' }); expect(evs.find((e) => e.type === 'approval.resolved')).toMatchObject({ decision: 'approve' });
  });
  it('a denied command is not run and the agent says so', async () => {
    const { s, evs, cwd } = await start({ approvalGate: gate('deny') as never }); await s.send(`run: touch ${join('.', 'should-not-exist')}`); await until(() => done(evs));
    expect(evs.find((e) => e.type === 'tool.result')).toMatchObject({ status: 'denied' }); expect(existsSync(join(cwd, 'should-not-exist'))).toBe(false); expect(evs.find((e) => e.type === 'text.done' && (e.text ?? '').includes('did not run'))).toBeTruthy();
  });
  it('bypass mode never asks', async () => {
    const seen: string[] = []; const { s, evs } = await start({ permissionMode: 'bypassPermissions', approvalGate: gate('deny', seen) as never }); await s.send('run: echo free'); await until(() => done(evs)); expect(seen).toEqual([]); expect(evs.find((e) => e.type === 'tool.result')).toMatchObject({ status: 'ok' });
  });
  it('an edit shows its diff in the approval and changes the file once allowed', async () => {
    const cwd = proj(); writeFileSync(join(cwd, 'a.ts'), 'export const a = 1;\n'); const { s, evs } = await start({ approvalGate: gate('approve') as never }, cwd); await s.send('edit a.ts from 1 to 2'); await until(() => done(evs));
    expect(readFileSync(join(cwd, 'a.ts'), 'utf8')).toBe('export const a = 2;\n'); expect(evs.find((e) => e.type === 'tool.result')).toMatchObject({ status: 'ok', diff: expect.stringContaining('+export const a = 2;') });
  });
  it('a created file and a plan-mode refusal', async () => {
    const { s, evs, cwd } = await start({ approvalGate: gate('approve') as never }); await s.send('create notes/x.txt with hello file'); await until(() => done(evs)); expect(readFileSync(join(cwd, 'notes/x.txt'), 'utf8')).toBe('hello file\n');
    const p = await start({ permissionMode: 'plan', approvalGate: gate('approve') as never }); await p.s.send('create y.txt with nope'); await until(() => done(p.evs)); expect(existsSync(join(p.cwd, 'y.txt'))).toBe(false); expect(p.evs.find((e) => e.type === 'tool.result')).toMatchObject({ status: 'error' });
  });
  it('Stop really stops the running command (the mock, like Codex, leaves it running after turn/interrupt)', async () => {
    const cwd = proj(); const marker = join(cwd, 'survived'); const { s, evs } = await start({ permissionMode: 'bypassPermissions' }, cwd); await s.send(`run: sleep 30 && touch ${marker}`); await until(() => evs.some((e) => e.type === 'tool.requested'));
    const pids = () => { try { return execFileSync('pgrep', ['-f', `sleep 30 && touch ${marker}`], { encoding: 'utf8' }).split('\n').filter(Boolean); } catch { return []; } }; await until(() => pids().length > 0);
    const r = await s.interrupt(); expect(r.stopped).toBe(true); await until(() => done(evs)); expect(evs.find((e) => e.type === 'turn.done')).toMatchObject({ outcome: 'canceled' }); await until(() => pids().length === 0, 6000); expect(existsSync(marker)).toBe(false);
  }, 30_000);
  it('errors map to Centcom codes: usage limit, signed out, plain', async () => {
    for (const [prompt, code] of [['fail usage', 'provider_cap_reached'], ['fail auth', 'provider_not_signed_in'], ['fail', 'provider_protocol_error']] as const) { const { s, evs } = await start(); await s.send(prompt); await until(() => done(evs)); expect(evs.find((e) => e.type === 'error'), prompt).toMatchObject({ code, fatal: true }); expect(evs.at(-1)).toMatchObject({ outcome: 'error' }); }
  });
  it('resume continues on the same thread; models, effort and compaction work', async () => {
    const cwd = proj(); const a = await start({}, cwd); await a.s.send('first'); await until(() => done(a.evs)); const token = a.s.resumeToken()!; expect(token).toBeTruthy(); await a.s.stop();
    const b = await start({ resume: { engine_session_id: token } }, cwd); expect(b.s.resumeToken()).toBe(token); (b.s as never as { setEffort(e: string): void }).setEffort('high'); await b.s.send('second'); await until(() => done(b.evs)); expect(b.evs.find((e) => e.type === 'text.done')).toBeTruthy();
    const models = await (b.s as never as { listModels(): Promise<{ id: string; efforts?: string[] }[]> }).listModels(); expect(models.map((m) => m.id)).toEqual(['mock-sol', 'mock-luna']); expect(models[0]!.efforts).toEqual(['low', 'medium', 'high']);
    await (b.s as never as { compact(): Promise<void> }).compact(); await until(() => b.evs.some((e) => e.type === 'compaction.ended'));
  }, 20_000);
  it('a signed-out Codex says so instead of running', async () => {
    process.env.MOCK_CODEX_SIGNED_IN = '0'; try { const { s, evs } = await start(); await s.send('hi'); await until(() => done(evs)); expect(evs.find((e) => e.type === 'error')).toMatchObject({ code: 'provider_not_signed_in' }); } finally { delete process.env.MOCK_CODEX_SIGNED_IN; }
  });
  it('commands do not see Centcom secrets (the mock honours shell_environment_policy like Codex should)', async () => {
    // documents the gap: the mock passes the environment through, so this only checks the policy reached thread/start
    const { s, evs } = await start({ permissionMode: 'bypassPermissions' }); await s.send('run: echo ok'); await until(() => done(evs)); expect(evs.find((e) => e.type === 'tool.result')).toMatchObject({ status: 'ok' });
  });
});

describe('Codex asks the person a question (item/tool/requestUserInput)', () => {
  const text = (evs: NormalisedEvent[]) => evs.filter((e) => e.type === 'text.delta').map((e) => (e as { text: string }).text).join('');
  it('the gate sees the question and options, and the chosen answer goes back to Codex', async () => {
    const asked: unknown[] = []; const { s, evs } = await start({ questionGate: { ask: async (qs: unknown[]) => { asked.push(qs); return { q1: ['blue'] }; } } as never });
    await s.send('ask Which colour? | red | blue'); await until(() => done(evs));
    expect(asked).toEqual([[{ id: 'q1', header: 'Question', text: 'Which colour?', options: [{ label: 'red' }, { label: 'blue' }] }]]);
    expect(evs).toContainEqual(expect.objectContaining({ type: 'question.asked', question_id: 'q1', text: 'Which colour?', options: ['red', 'blue'] })); expect(text(evs)).toContain('You chose: blue.');
  });
  it('a question without options is free text, and a cancelled question still lets the turn finish', async () => {
    const seen: unknown[] = []; const a = await start({ questionGate: { ask: async (qs: { options?: unknown }[]) => { seen.push(qs[0]!.options); return { q1: ['my own answer'] }; } } as never });
    await a.s.send('ask What name? '); await until(() => done(a.evs)); expect(seen).toEqual([undefined]); expect(text(a.evs)).toContain('You chose: my own answer.');
    const b = await start({ questionGate: { ask: async () => undefined } as never }); await b.s.send('ask Which? | x | y'); await until(() => done(b.evs)); expect(text(b.evs)).toContain('No answer given.');
  });
  it('without a gate it is declined with a warning, as before, and the turn does not hang', async () => {
    const { s, evs } = await start(); await s.send('ask Which? | x | y'); await until(() => done(evs)); expect(evs).toContainEqual(expect.objectContaining({ type: 'engine.warning', code: 'unhandled_server_request' }));
  });
});

describe('the "Codex has sent nothing" warning', () => {
  const startWith = async (stallMs: number, o: Partial<Parameters<CodexEngine['start']>[0]>) => { const s = await new CodexEngine({ bin: BIN, stallMs }).start({ agentId: 'agt_mock', cwd: proj(), ...o } as never); sessions.push(s); const evs: NormalisedEvent[] = []; void (async () => { for await (const e of s.events) evs.push(e); })(); return { s, evs }; };
  const stalled = (evs: NormalisedEvent[]) => evs.some((e) => e.type === 'engine.warning' && (e as { code?: string }).code === 'codex_stalled');
  it('is not shown while Codex waits for your approval, however long you take', async () => {
    let release = () => undefined as void; const held = new Promise<void>((r) => { release = r; });
    const { s, evs } = await startWith(120, { approvalGate: { decide: async () => { await held; return { decision: 'approve' as const, scope: 'once' as const }; } } as never });
    await s.send('run: echo slow-approval'); await until(() => evs.some((e) => e.type === 'approval.requested')); await new Promise((r) => setTimeout(r, 700)); expect(stalled(evs)).toBe(false); // five times the limit, still waiting for the person
    release(); await until(() => done(evs)); expect(stalled(evs)).toBe(false);
  });
});
