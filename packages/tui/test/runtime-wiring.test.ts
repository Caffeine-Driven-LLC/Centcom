import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeEngine, type FakeEngineOptions } from '@centcom/testkit';
import type { ApprovalRequest, EventBody } from '@centcom/agent';
import { afterAll, describe, expect, it } from 'vitest';
import { AppController } from '../src/controller.js';
import { buildRuntime } from '../src/runtime.js';

const dirs: string[] = []; afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const tmp = (p: string) => { const d = mkdtempSync(join(tmpdir(), p)); dirs.push(d); return d; };
const git = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
function repo() { const d = tmp('centcom-wire-'); git(d, 'init', '-q', '-b', 'main'); git(d, 'config', 'commit.gpgsign', 'false'); writeFileSync(join(d, 'a.txt'), 'original\n'); git(d, 'add', '-A'); git(d, 'commit', '-q', '-m', 'i'); return d; }
const req = (o: Partial<ApprovalRequest>): ApprovalRequest => ({ approval_id: 'apr_' + Math.random().toString(36).slice(2), agent_id: 'agt_you', tool_id: 't', tool: 'Edit', summary: 'edit', risk: 'medium', ...o });
const until = async (f: () => boolean, ms = 4000) => { const t0 = Date.now(); while (!f()) { if (Date.now() - t0 > ms) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 15)); } };
async function app(o: { cwd?: string; dangerous?: boolean; mode?: 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions'; script?: FakeEngineOptions['script']; checkpoints?: boolean } = {}) {
  const cwd = o.cwd ?? repo(); const configDir = tmp('centcom-cfg-'); const home = tmp('centcom-home-');
  const engine = new FakeEngine({ id: 'claude-code', ...(o.script ? { script: o.script } : {}) });
  const rt = await buildRuntime({ cwd, engineId: 'claude-code', demo: false, dangerous: o.dangerous, configDir, home, checkpoints: o.checkpoints ?? true });
  const ctl = new AppController({ ...rt.options, engine: engine as never, demo: false, cwd, version: 't', skills: [], permissionMode: o.mode ?? 'default', dangerous: o.dangerous });
  rt.bind(ctl); await ctl.start(); return { ctl, cwd, configDir, engine, rt, home };
}
const notices = (c: AppController) => c.state.items.filter((i) => i.kind === 'notice').map((i) => (i.kind === 'notice' ? `${i.text}\n${i.detail ?? ''}` : ''));

describe('permission policy in the app', () => {
  it('a read inside the project goes through without asking; an edit asks; a credentials file is blocked in every mode with a notice', async () => {
    const { ctl, cwd } = await app();
    expect(await ctl.decide(req({ tool: 'Read', path: 'a.txt', risk: 'low' }))).toMatchObject({ decision: 'approve' }); expect(ctl.state.approvals).toHaveLength(0);
    const p = ctl.decide(req({ tool: 'Edit', path: 'a.txt' })); await until(() => ctl.state.approvals.length === 1); ctl.answerApproval('approve'); expect(await p).toMatchObject({ decision: 'approve' });
    const blocked = await ctl.decide(req({ tool: 'Read', path: join(cwd, '../../.ssh/id_rsa') })); expect(blocked).toMatchObject({ decision: 'deny', reason: 'credential_path' }); expect(notices(ctl).some((n) => /Blocked/.test(n) && /credentials/.test(n))).toBe(true);
    ctl.stop();
  });
  it('"always" saves a project rule that answers the next identical request, and /permissions shows and removes it', async () => {
    const { ctl } = await app(); const p = ctl.decide(req({ tool: 'Bash', command: 'npm test', risk: 'medium' })); await until(() => ctl.state.approvals.length === 1); ctl.answerApproval('approve', 'always'); await p; await new Promise((r) => setTimeout(r, 50));
    expect(await ctl.decide(req({ tool: 'Bash', command: 'npm test', risk: 'medium' }))).toMatchObject({ decision: 'approve' }); expect(ctl.state.approvals).toHaveLength(0);
    await ctl.runCommand('/permissions list'); const listed = notices(ctl).at(-1)!; expect(listed).toMatch(/1 permission rule/); const id = /^(\S+)\s+allow/m.exec(listed.split('\n').slice(1).join('\n'))![1]!;
    await ctl.runCommand(`/permissions remove ${id}`); const again = ctl.decide(req({ tool: 'Bash', command: 'npm test' })); await until(() => ctl.state.approvals.length === 1); ctl.answerApproval('deny'); await again; ctl.stop();
  });
  it('plan mode refuses writes; bypass needs the dangerous flag and never lifts the hard denies', async () => {
    const plan = await app({ mode: 'plan' }); expect(await plan.ctl.decide(req({ tool: 'Edit', path: 'a.txt' }))).toMatchObject({ decision: 'deny', reason: 'plan_mode' }); plan.ctl.stop();
    const noFlag = await app({ mode: 'bypassPermissions' }); const asked = noFlag.ctl.decide(req({ tool: 'Bash', command: 'rm -rf build', risk: 'high' })); await until(() => noFlag.ctl.state.approvals.length === 1); noFlag.ctl.answerApproval('deny'); await asked; noFlag.ctl.stop();
    const flag = await app({ mode: 'bypassPermissions', dangerous: true }); expect(await flag.ctl.decide(req({ tool: 'Bash', command: 'rm -rf build', risk: 'high' }))).toMatchObject({ decision: 'approve' });
    expect(await flag.ctl.decide(req({ tool: 'Edit', path: join(flag.home, '.aws/credentials') }))).toMatchObject({ decision: 'deny' }); flag.ctl.stop();
  });
  it('the risk shown comes from Centcom\'s classifier, not only from the engine', async () => { const { ctl } = await app(); const p = ctl.decide(req({ tool: 'Bash', command: 'git push --force', risk: 'low' })); await until(() => ctl.state.approvals.length === 1); expect(ctl.state.approvals[0]!.req.risk).toBe('high'); ctl.answerApproval('deny'); await p; ctl.stop(); });
  it('interrupting cancels waiting approvals through the policy engine', async () => { const { ctl } = await app(); const p = ctl.decide(req({ tool: 'Bash', command: 'npm test' })); await until(() => ctl.state.approvals.length === 1); ctl.patch({ busy: true }); await ctl.interrupt(); expect(await p).toMatchObject({ decision: 'deny' }); expect(ctl.state.approvals).toHaveLength(0); ctl.stop(); });
  it('a project rules file is not used until it is trusted', async () => { const cwd = repo(); mkdirSync(join(cwd, '.centcom'), { recursive: true }); writeFileSync(join(cwd, '.centcom/permissions.local.json'), JSON.stringify({ v: 1, rules: [{ id: 'r1', tool: 'Bash', action: 'allow', scope: 'project', matcher: { command: 'npm test' }, created_at: '2026-10-06T00:00:00Z' }] })); const { rt, ctl } = await app({ cwd }); expect(rt.warnings.join(' ')).toMatch(/trust rules|not used/); ctl.stop(); });
  it('the demo keeps its simple rules and needs no files', async () => { const rt = await buildRuntime({ cwd: '/tmp', engineId: 'fake', demo: true }); expect(rt.options).toEqual({}); });
});

describe('checkpoints and /rewind in the app', () => {
  it('a checkpoint is taken before the prompt; /rewind lists it; /rewind 1 asks, then puts the file back', async () => {
    const { ctl, cwd, engine } = await app(); await ctl.submit('change a.txt please'); await until(() => engine.sessions[0]!.prompts.length === 1); writeFileSync(join(cwd, 'a.txt'), 'changed by the agent\n'); await until(() => !ctl.state.busy);
    await ctl.runCommand('/rewind'); expect(notices(ctl).at(-1)).toMatch(/change a\.txt please/);
    await ctl.runCommand('/rewind 1'); expect(notices(ctl).at(-1)).toMatch(/Type y to confirm[\s\S]*Put back 1 file: a\.txt[\s\S]*not undone/); expect(readFileSync(join(cwd, 'a.txt'), 'utf8')).toBe('changed by the agent\n');
    await ctl.submit('y'); await until(() => readFileSync(join(cwd, 'a.txt'), 'utf8') === 'original\n'); expect(notices(ctl).at(-1)).toMatch(/Rewound to before "change a\.txt please": 1 put back/); expect(engine.sessions[0]!.prompts).toEqual(['change a.txt please']); ctl.stop();
  });
  it('anything but y cancels; a missing number or a busy agent is explained', async () => { const { ctl, cwd, engine } = await app(); await ctl.submit('one'); await until(() => engine.sessions[0]!.prompts.length === 1); writeFileSync(join(cwd, 'a.txt'), 'x\n'); await until(() => !ctl.state.busy); await ctl.runCommand('/rewind 1'); await ctl.submit('no'); expect(notices(ctl).at(-1)).toMatch(/Nothing was rewound/); expect(readFileSync(join(cwd, 'a.txt'), 'utf8')).toBe('x\n'); await ctl.runCommand('/rewind 9'); expect(ctl.state.toasts.at(-1)!.text).toMatch(/No checkpoint 9/); ctl.stop(); });
  it('conversation rewind drops the later messages and resumes the engine at that point', async () => {
    const { ctl, engine } = await app(); await ctl.submit('first'); await until(() => !ctl.state.busy && engine.sessions[0]!.prompts.length === 1); await ctl.submit('second'); await until(() => !ctl.state.busy && engine.sessions[0]!.prompts.length === 2);
    await ctl.runCommand('/rewind 2 conversation'); await ctl.submit('y'); await until(() => engine.sessions.length === 2); expect(ctl.state.items.filter((i) => i.kind === 'user').map((i) => (i.kind === 'user' ? i.text : ''))).toEqual(['first']); expect(engine.starts[1]!.resume).toBeTruthy(); ctl.stop();
  });
  it('Esc twice when idle opens the list; once does nothing', async () => { const { ctl } = await app(); const n0 = notices(ctl).length; ctl.escIdle(); expect(notices(ctl).length).toBe(n0); ctl.escIdle(); await until(() => notices(ctl).length > n0); expect(notices(ctl).at(-1)).toMatch(/No checkpoints yet|Checkpoints/); ctl.stop(); });
  it('--no-checkpoints: nothing is saved and /rewind says so', async () => { const { ctl, cwd } = await app({ checkpoints: false }); await ctl.submit('x'); await ctl.runCommand('/rewind'); expect(ctl.state.toasts.at(-1)!.text).toMatch(/off/); expect(git(cwd, 'for-each-ref', 'refs/centcom/')).toBe(''); ctl.stop(); });
});

describe('context in the app', () => {
  const usage = (used: number): EventBody[] => [{ type: 'usage.report', input_tokens: 1, output_tokens: 1, cost_is_estimate: true, context_tokens: used, context_window: 200_000 }];
  it('warns once at 75% and when nearly full, from the engine\'s own numbers', async () => {
    const { ctl, engine } = await app({ script: (n: number) => ({ events: usage(n === 1 ? 160_000 : 196_000) }) }); await ctl.submit('a'); await until(() => notices(ctl).some((x) => /80% full/.test(x))); await ctl.submit('b'); await until(() => notices(ctl).some((x) => /almost full/.test(x))); expect(notices(ctl).filter((x) => /% full/.test(x))).toHaveLength(1); void engine; ctl.stop();
  });
  it('/compact explains when the engine has no compact command', async () => { const { ctl } = await app(); await ctl.runCommand('/compact'); expect(ctl.state.toasts.at(-1)!.text).toMatch(/no compact command/); ctl.stop(); });
});

describe('the fleet in the app', () => {
  async function fleetApp() {
    const cwd = repo(); const { createAgentBus, createFleetManager, createRunner, createWorktreeManager, nodeGit, nodeWtFs } = await import('@centcom/agent'); const { newIdGenerator } = await import('@centcom/protocol');
    const bus = createAgentBus({ onError: () => undefined }); const ids = newIdGenerator({ now: () => Date.now(), random: (n) => new Uint8Array(n).map(() => Math.floor(Math.random() * 256)) });
    const clock = { now: () => Date.now(), setTimeout: (f: () => void, ms: number) => setTimeout(f, ms), clearTimeout: (h: never) => clearTimeout(h) }; const quiet = { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined };
    const fake = new FakeEngine({ id: 'claude-code' }); const runner = createRunner({ engines: { get: () => fake as never }, bus, ids, clock, log: quiet, config: { maxParallel: 8 }, env: {} });
    const worktrees = createWorktreeManager({ git: nodeGit, fs: nodeWtFs, bus, clock, config: { root: tmp('centcom-wt-') } }); const manager = createFleetManager({ runner, worktrees, entitlements: { maxParallelAgents: () => 4 }, bus, ids, clock, config: { stagger_ms: 0 } });
    const ctl = new AppController({ engine: new FakeEngine({ id: 'claude-code' }) as never, demo: false, cwd, version: 't', skills: [], fleet: { manager, bus, ownerSlug: 'alex' } }); await ctl.start(); return { ctl, cwd, fake, manager, runner };
  }
  it('/fleet start 2 runs two agents on their own branches; they show in the fleet panel; /fleet lists them; stop all ends them', async () => {
    const { ctl, fake } = await fleetApp(); await ctl.runCommand('/fleet start 2 fix the flaky test'); await until(() => fake.sessions.length === 2, 10_000);
    const rows = ctl.state.agents.filter((a) => !a.mine); expect(rows.map((a) => a.name)).toEqual(['1 fix the flaky test 1', '2 fix the flaky test 2']); expect(rows.every((a) => /^centcom\/alex\//.test(a.branch))).toBe(true); expect(new Set(fake.sessions.map((s) => s.o.cwd)).size).toBe(2); expect(ctl.state.fleet).toBe(true);
    await ctl.runCommand('/fleet'); expect(notices(ctl).at(-1)).toMatch(/2 fleet agents[\s\S]*1\. fix the flaky test 1/); await ctl.runCommand('/fleet stop all'); await until(() => ctl.state.agents.filter((a) => !a.mine).every((a) => a.state === 'idle' || a.state === 'success'), 10_000); ctl.stop();
  }, 30_000);
  it('an agent that commits announces its branch is ready, and preview checks it for conflicts', async () => {
    const { ctl, fake, manager, runner } = await fleetApp(); await ctl.runCommand('/fleet start add a file'); await until(() => fake.sessions.length === 1, 10_000); const wt = fake.sessions[0]!.o.cwd; writeFileSync(join(wt, 'new.txt'), 'x'); git(wt, 'add', '-A'); git(wt, 'commit', '-q', '-m', 'agent work');
    const id = manager.list()[0]!.id; await runner.get(id as never)!.stop(); await until(() => notices(ctl).some((n) => /is ready \(1 commit, 1 file\)/.test(n)), 10_000);
    await ctl.runCommand('/fleet preview 1'); await until(() => notices(ctl).some((n) => /merges cleanly/.test(n))); expect(ctl.state.agents.find((a) => a.id === id)!.note).toBe('branch ready'); ctl.stop();
  }, 30_000);
  it('usage errors and the demo are explained', async () => { const { ctl } = await fleetApp(); await ctl.runCommand('/fleet start'); expect(ctl.state.toasts.at(-1)!.text).toMatch(/Usage/); await ctl.runCommand('/fleet stop 7'); expect(ctl.state.toasts.at(-1)!.text).toMatch(/Which agent/); ctl.stop(); const demo = new AppController({ engine: new FakeEngine() as never, demo: true, cwd: '/tmp', version: 't', skills: [] }); await demo.runCommand('/fleet'); expect(demo.state.toasts.at(-1)!.text).toMatch(/real engine/); demo.stop(); }, 30_000);
});

describe('file locks between agents', () => {
  it('two agents changing the same file are told their branches will conflict', async () => {
    const cwd = repo(); const rt = await buildRuntime({ cwd, engineId: 'claude-code', demo: false, configDir: tmp('centcom-cfg-'), home: tmp('centcom-home-'), checkpoints: false });
    const ctl = new AppController({ ...rt.options, engine: new FakeEngine({ id: 'claude-code' }) as never, demo: false, cwd, version: 't', skills: [] }); rt.bind(ctl); await ctl.start();
    const ev = (agent: string, path: string) => rt.options.fleet!.bus.emit('agent:event', { agent_id: agent as never, seq: 1, event: { type: 'tool.requested', tool_id: 't', name: 'Edit', input_summary: path, risk: 'medium', path, v: 1, seq: 1, ts: 't', agent_id: agent } as never });
    ev('agt_01JTEST0000000000000000001', 'src/a.ts'); await until(() => true); await new Promise((r) => setTimeout(r, 50)); ev('agt_01JTEST0000000000000000002', 'src/a.ts'); await until(() => ctl.state.toasts.some((t) => /src\/a\.ts.*conflict/.test(t.text)));
    for (const o of rt.options.observers!) o('agt_you', { type: 'tool.requested', tool_id: 'x', name: 'Read', input_summary: 'r', risk: 'low', path: 'src/b.ts', v: 1, seq: 2, ts: 't', agent_id: 'agt_you' } as never); expect(ctl.state.toasts.filter((t) => /src\/b\.ts/.test(t.text))).toEqual([]); // reading is not changing
    ctl.stop();
  });
});

describe('resuming across engines', () => {
  it('a conversation saved with Codex is not handed to Claude as a session id; it continues from a summary', async () => {
    const { SessionStore } = await import('../src/sessions.js'); const dir = tmp('centcom-sess-'); const store = new SessionStore(dir); const cwd = repo();
    store.save({ id: 'ses_01JTEST0000000000000000001', cwd, engine: 'codex', title: 'old', resumeToken: 'thread_codex_123', createdAt: 1, updatedAt: 2, messages: 1 }, [{ kind: 'user', id: 'u1', text: 'make the tests pass', ts: 1 }, { kind: 'assistant', id: 'a1', messageId: 'm', agentId: 'x', text: 'I fixed two tests.', done: true }]);
    const engine = new FakeEngine({ id: 'claude-code' }); const ctl = new AppController({ engine: engine as never, demo: false, cwd, version: 't', skills: [], sessions: store, resume: 'last' }); await ctl.start();
    expect(engine.starts[0]!.resume).toBeUndefined(); expect(engine.sessions[0]!.o.systemPromptAppend).toMatch(/make the tests pass[\s\S]*I fixed two tests/); expect(notices(ctl).some((n) => /was with Codex/.test(n))).toBe(true); ctl.stop();
    const store2 = new SessionStore(tmp('centcom-sess-')); store2.save({ id: 'ses_01JTEST0000000000000000002', cwd, engine: 'codex', title: 'old', resumeToken: 'thread_codex_123', createdAt: 1, updatedAt: 2, messages: 1 }, [{ kind: 'user', id: 'u1', text: 'hi', ts: 1 }]); const same = new FakeEngine({ id: 'codex' }); const c2 = new AppController({ engine: same as never, demo: false, cwd, version: 't', skills: [], sessions: store2, resume: 'last' }); await c2.start(); expect(same.starts[0]!.resume).toBe('thread_codex_123'); c2.stop(); // the same engine resumes its own session
  });
});

describe('agent.approval_timeout_ms reaches the permission engine', () => {
  it('an approval nobody answers is declined after the configured time, and the controller knows the deadline', async () => {
    const cwd = repo(); const rt = await buildRuntime({ cwd, engineId: 'claude-code', demo: false, configDir: tmp('centcom-cfg-'), home: tmp('centcom-home-'), checkpoints: false, approvalTimeoutMs: 1500 });
    expect(rt.options.approvalTimeoutMs).toBe(1500);
    const ctl = new AppController({ ...rt.options, engine: new FakeEngine({ id: 'claude-code' }) as never, demo: false, cwd, version: 't', skills: [] }); rt.bind(ctl);
    const p = ctl.decide(req({ tool: 'Bash', command: 'npm test' })); await until(() => ctl.state.approvals.length === 1); const left = ctl.state.approvals[0]!.expiresAt! - Date.now(); expect(left).toBeGreaterThan(1000); expect(left).toBeLessThanOrEqual(1500);
    expect(await p).toMatchObject({ decision: 'deny' }); expect(ctl.state.approvals).toHaveLength(0); ctl.stop();
  }, 15_000);
});
