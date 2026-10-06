import { describe, expect, it } from 'vitest';
import { ProviderError } from '../../src/index.js';
import { RunnerBusy, RunnerError } from '../../src/runner/index.js';
import { SECRET_PATTERNS } from '@centcom/protocol';
import { FAKE_REPLY, type FakeSession } from '@centcom/testkit';
import { flush, rig, settle } from './helpers.js';

const sess = (r: ReturnType<typeof rig>, i = 0) => r.engine.sessions[i] as FakeSession;

describe('lifecycle', () => {
  it('publishes started, gap-free events and exited in order', async () => {
    const r = rig(); const h = await r.runner.start(await r.spec()); await settle(r); expect(h.status()).toBe('waiting');
    await h.stop(); await settle(r);
    const names = r.busLog.map((b) => b.name); expect(names[0]).toBe('agent:started'); expect(names.at(-1)).toBe('agent:exited'); expect(r.busLog.at(-1)!.p.agent_id).toBe(h.id);
    const seqs = r.busLog.filter((b) => b.name === 'agent:event').map((b) => b.p.seq as number); expect(seqs.length).toBeGreaterThan(FAKE_REPLY.length); expect(seqs).toEqual(seqs.map((_x, i) => i + 1));
    expect(r.busLog.filter((b) => b.name === 'agent:event').every((b) => b.p.agent_id === h.id && b.p.event.agent_id === h.id)).toBe(true);
  });
  it('a finished turn then stop() is outcome ok; an idle agent stops quickly', async () => {
    const r = rig(); const h = await r.runner.start(await r.spec()); await settle(r); expect(r.busLog.some((b) => b.name === 'agent:event' && b.p.event.type === 'turn.done')).toBe(true);
    await h.stop(); expect(r.busLog.at(-1)!.p).toMatchObject({ agent_id: h.id, outcome: 'ok' }); expect(h.status()).toBe('exited'); expect(r.runner.list()[0]).toMatchObject({ status: 'exited', outcome: 'ok', turns: 1 });
  });
  it('oneShot ends by itself after the first turn', async () => {
    const r = rig(); const h = await r.runner.start(await r.spec({ oneShot: true })); await settle(r); expect(h.status()).toBe('exited'); expect(r.busLog.at(-1)!.p.outcome).toBe('ok');
  });
  it('a second prompt while a turn is running is queued, run in order, and the queue is capped at 20', async () => {
    const r = rig({ engine: { script: { gapMs: 10 } } }); const h = await r.runner.start(await r.spec()); await flush();
    for (let i = 1; i <= 20; i++) await h.send(`q${i}`); await expect(h.send('one too many')).rejects.toMatchObject({ code: 'queue_full' });
    expect(r.runner.list()[0]!.queued).toBe(20); await settle(r, 5000); expect(sess(r).prompts).toEqual(['hello', ...Array.from({ length: 20 }, (_x, i) => `q${i + 1}`)]);
  });
  it('events() follows live and can replay the ring', async () => {
    const r = rig(); const h = await r.runner.start(await r.spec()); await settle(r); const replay: number[] = []; const it = h.events({ replay: true })[Symbol.asyncIterator]();
    for (let i = 0; i < 4; i++) replay.push((await it.next()).value.seq); expect(replay).toEqual([1, 2, 3, 4]); const live = it.next(); await h.send('again'); expect((await live).value.seq).toBeGreaterThan(replay.at(-1)!); await it.return!();
  });
  it('the ring keeps only the last 1000 events', async () => {
    const r = rig({ engine: { script: { events: Array.from({ length: 1500 }, (_x, i) => ({ type: 'text.delta' as const, message_id: 'm', index: i, text: 'x' })) } } }); const h = await r.runner.start(await r.spec()); await settle(r);
    const got: number[] = []; const it = h.events({ replay: true })[Symbol.asyncIterator](); for (let i = 0; i < 1000; i++) got.push((await it.next()).value.seq); await it.return!(); expect(got[0]).toBeGreaterThan(500); expect(got.at(-1)! - got[0]!).toBe(999);
  });
});

describe('limits', () => {
  it('4 agents run side by side, the 5th is refused at once, and succeeds when a slot frees up', async () => {
    const r = rig(); const hs = await Promise.all([1, 2, 3, 4].map(async () => r.runner.start(await r.spec({ prompt: '' })))); expect(hs.map((h) => h.status())).toEqual(['waiting', 'waiting', 'waiting', 'waiting']);
    const t = Date.now(); await expect(r.runner.start(await r.spec())).rejects.toBeInstanceOf(RunnerBusy); expect(Date.now() - t).toBeLessThan(500); expect(r.engine.starts).toHaveLength(4);
    await hs[0]!.stop(); const fifth = await r.runner.start(await r.spec()); expect(fifth.status()).not.toBe('exited');
  });
  it('racing starts cannot both take the last slot, and the hard cap is 16', async () => {
    const r = rig({ config: { maxParallel: 1 } }); const specs = [await r.spec(), await r.spec()]; const res = await Promise.allSettled(specs.map((s) => r.runner.start(s))); expect(res.map((x) => x.status).sort()).toEqual(['fulfilled', 'rejected']);
    const big = rig({ config: { maxParallel: 99 } }); const many = await Promise.allSettled(Array.from({ length: 20 }, async () => big.runner.start(await big.spec({ prompt: '' })))); expect(many.filter((x) => x.status === 'fulfilled')).toHaveLength(16);
  });
  it('one folder, one agent, unless sharing is allowed; a missing folder is refused before anything is spawned', async () => {
    const r = rig(); const cwd = await r.dirs(); await r.runner.start({ engine: 'fake', cwd, prompt: '' }); await expect(r.runner.start({ engine: 'fake', cwd, prompt: '' })).rejects.toMatchObject({ code: 'cwd_in_use' });
    await expect(r.runner.start({ engine: 'fake', cwd, prompt: '', allowSharedCwd: true })).resolves.toBeTruthy(); const before = r.engine.starts.length;
    await expect(r.runner.start({ engine: 'fake', cwd: cwd + '/nope', prompt: '' })).rejects.toMatchObject({ code: 'cwd_invalid' }); expect(r.engine.starts.length).toBe(before);
    await expect(r.runner.start({ engine: 'fake', cwd: new URL(import.meta.url).pathname, prompt: '' })).rejects.toMatchObject({ code: 'cwd_invalid' }); // a file is not a folder
  });
  it('the folder is free again once its agent has exited', async () => { const r = rig(); const cwd = await r.dirs(); const h = await r.runner.start({ engine: 'fake', cwd, prompt: '' }); await h.stop(); await expect(r.runner.start({ engine: 'fake', cwd, prompt: '' })).resolves.toBeTruthy(); });
  it('a start that takes longer than 30 s fails and leaves no slot taken', async () => {
    const r = rig({ engine: { startDelayMs: 60_000 }, config: { maxParallel: 1 } }); const p = r.runner.start(await r.spec()); const caught = p.catch((e) => e); for (let i = 0; i < 500 && r.engine.starts.length === 0; i++) await new Promise((x) => setTimeout(x, 2)); // the runner stats the folder (real IO) before it starts the engine; wait for that, not for a fixed number of ticks
    await settle(r); await r.clock.advance(30_000); await flush(); expect(await caught).toMatchObject({ code: 'engine_start_timeout' });
    expect(r.runner.list()).toEqual([]); const ok = rig(); await expect(ok.runner.start(await ok.spec())).resolves.toBeTruthy();
  });
  it('a failing engine start, an unknown engine, a disabled provider and a failed preflight spawn nothing', async () => {
    const f = rig({ engine: { failStart: new Error('boom') } }); await expect(f.runner.start(await f.spec())).rejects.toThrow('boom'); expect(f.runner.list()).toEqual([]); expect(f.busLog).toEqual([]);
    const r = rig(); await expect(r.runner.start(await r.spec({ engine: 'codex' }))).rejects.toMatchObject({ code: 'engine_unknown' });
    const d = rig({ deps: { providerEnabled: () => false } }); await expect(d.runner.start(await d.spec())).rejects.toMatchObject({ code: 'provider_method_disabled' }); expect(d.engine.starts).toHaveLength(0);
  });
  it('a failed preflight (not installed) rejects with the provider error and spawns nothing', async () => {
    const e = rig(); const { createRunner } = await import('../../src/runner/index.js'); const { createAgentBus } = await import('../../src/index.js'); const { newIdGenerator } = await import('@centcom/protocol');
    const runner = createRunner({ engines: { get: () => e.engine, preflight: async (id) => { throw new ProviderError('provider_not_installed', id, 'no'); } }, bus: createAgentBus({ onError: () => undefined }), ids: newIdGenerator({ now: () => 1, random: (n) => new Uint8Array(n) }), clock: e.clock, log: { debug() {}, info() {}, warn() {}, error() {} }, env: {} });
    await expect(runner.start(await e.spec())).rejects.toMatchObject({ code: 'provider_not_installed' }); expect(e.engine.starts).toHaveLength(0);
  });
  it('max_parallel from config is respected below the cap', async () => { const r = rig({ config: { maxParallel: 2 } }); await r.runner.start(await r.spec({ prompt: '' })); await r.runner.start(await r.spec({ prompt: '' })); await expect(r.runner.start(await r.spec())).rejects.toBeInstanceOf(RunnerBusy); });
});

describe('crashes', () => {
  it('a killed engine crashes that agent only; the others keep working and stay listed', async () => {
    const r = rig(); const hs = await Promise.all([1, 2, 3, 4].map(async () => r.runner.start(await r.spec({ prompt: '' })))); await settle(r);
    r.engine.sessions.find((x) => x.agentId === hs[1]!.id)!.crash('SIGKILL'); await settle(r); expect(r.busLog.filter((b) => b.name === 'agent:exited')).toHaveLength(1);
    expect(r.busLog.find((b) => b.name === 'agent:exited')!.p).toMatchObject({ agent_id: hs[1]!.id, outcome: 'crash', signal: 'SIGKILL' });
    const before = r.busLog.length; await Promise.all([hs[0]!, hs[2]!, hs[3]!].map((h) => h.send('still there'))); await settle(r); expect(r.busLog.length).toBeGreaterThan(before + 10);
    const list = r.runner.list(); expect(list).toHaveLength(4); expect(list.find((a) => a.id === hs[1]!.id)).toMatchObject({ status: 'crashed', outcome: 'crash' }); expect(list.filter((a) => a.status === 'waiting')).toHaveLength(3);
    await expect(hs[1]!.send('x')).rejects.toMatchObject({ code: 'agent_gone' });
  });
  it('the event stream ending on its own is a crash too', async () => {
    const r = rig(); const h = await r.runner.start(await r.spec({ prompt: '' })); await settle(r); (sess(r).events as { close(): void }).close(); await settle(r); expect(h.status()).toBe('crashed');
  });
  it('on-crash restarts at +1 s and +4 s with the resume token, and gives up on the third crash', async () => {
    const r = rig(); const h = await r.runner.start(await r.spec({ restart: 'on-crash', prompt: '' })); await settle(r); const t0 = r.clock.now();
    sess(r, 0).crash(); await settle(r, 999); expect(r.engine.starts).toHaveLength(1); await settle(r, 2); expect(r.engine.starts).toHaveLength(2); expect(r.engine.starts[1]).toMatchObject({ at: t0 + 1000, resume: 'fake-session-1' }); expect(h.status()).toBe('waiting');
    const t1 = r.clock.now(); sess(r, 1).crash(); await settle(r, 3999); expect(r.engine.starts).toHaveLength(2); await settle(r, 2); expect(r.engine.starts).toHaveLength(3); expect(r.engine.starts[2]).toMatchObject({ at: t1 + 4000, resume: 'fake-session-2' });
    expect(r.busLog.filter((b) => b.name === 'agent:exited')).toHaveLength(0); sess(r, 2).crash(); await settle(r, 60_000); expect(r.engine.starts).toHaveLength(3); expect(r.busLog.filter((b) => b.name === 'agent:exited')).toHaveLength(1); expect(r.busLog.at(-1)!.p.outcome).toBe('crash'); expect(h.status()).toBe('crashed');
  });
  it('restart: never is the default', async () => { const r = rig(); const h = await r.runner.start(await r.spec({ prompt: '' })); await settle(r); sess(r).crash(); await settle(r, 10_000); expect(r.engine.starts).toHaveLength(1); expect(h.status()).toBe('crashed'); });
  it('an agent that crashes mid-turn denies its pending approvals', async () => {
    const r = rig(); const h = await r.runner.start(await r.spec({ prompt: '' })); await settle(r); const s = sess(r); const d = s.o.approvalGate!.decide({ approval_id: 'apr_1', agent_id: h.id, tool_id: 't', tool: 'Bash', summary: 's', risk: 'high' }); s.crash(); await settle(r);
    await expect(d).resolves.toMatchObject({ decision: 'deny' }); expect(r.busLog.some((b) => b.name === 'agent:approval_resolved' && b.p.decision === 'cancel')).toBe(true);
  });
});

describe('interrupt and shutdown', () => {
  it('an engine that honours interrupt ends the turn within a second and the agent lives on', async () => {
    const r = rig({ engine: { script: { hang: true } } }); const h = await r.runner.start(await r.spec()); await settle(r); expect(h.status()).toBe('running'); await h.interrupt(); await settle(r, 1000); expect(h.status()).toBe('waiting'); expect(sess(r).signals).toEqual([]);
    expect(r.busLog.some((b) => b.name === 'agent:event' && b.p.event.type === 'turn.done' && b.p.event.outcome === 'canceled')).toBe(true); expect(r.busLog.filter((b) => b.name === 'agent:exited')).toHaveLength(0);
  });
  it('an engine that ignores it gets SIGTERM at exactly 5 s and SIGKILL at 7 s, and the agent ends canceled', async () => {
    const r = rig({ engine: { script: { hang: true, ignoreInterrupt: true, ignoreTerm: true } } }); const h = await r.runner.start(await r.spec()); await settle(r); await h.interrupt();
    await settle(r, 4999); expect(sess(r).signals).toEqual([]); await settle(r, 1); expect(sess(r).signals).toEqual(['SIGTERM']); await settle(r, 1999); expect(sess(r).signals).toEqual(['SIGTERM']); await settle(r, 1); expect(sess(r).signals).toEqual(['SIGTERM', 'SIGKILL']);
    await settle(r); expect(r.busLog.at(-1)!.p).toMatchObject({ outcome: 'canceled', reason: 'interrupt_ignored' }); expect(h.status()).toBe('exited');
  });
  it('stopAll with 4 hung, deaf agents finishes within 8 s', async () => {
    const r = rig({ engine: { script: { hang: true, ignoreInterrupt: true, ignoreTerm: true } } }); await Promise.all([1, 2, 3, 4].map(async () => r.runner.start(await r.spec()))); await settle(r);
    const t0 = r.clock.now(); let done = false; const p = r.runner.stopAll().then(() => { done = true; }); await settle(r, 7999); await flush(); await settle(r, 1); await p; expect(done).toBe(true); expect(r.clock.now() - t0).toBeLessThanOrEqual(8000);
    expect(r.engine.sessions.every((s) => s.signals.join() === 'SIGTERM,SIGKILL')).toBe(true); expect(r.busLog.filter((b) => b.name === 'agent:exited')).toHaveLength(4);
  });
  it('stop() on a working but cooperative agent ends it as canceled without any signal', async () => {
    const r = rig({ engine: { script: { hang: true } } }); const h = await r.runner.start(await r.spec()); await settle(r); await h.stop(); expect(sess(r).signals).toEqual([]); expect(r.busLog.at(-1)!.p.outcome).toBe('canceled');
  });
  it('a turn that goes silent for 30 minutes is stopped and reported as an error with watchdog_timeout', async () => {
    const r = rig({ engine: { script: { hang: true, ignoreInterrupt: true, ignoreTerm: true } } }); const h = await r.runner.start(await r.spec()); await settle(r); await settle(r, 30 * 60_000 - 1); expect(h.status()).toBe('running'); await settle(r, 1); await settle(r, 7000); await settle(r);
    expect(r.busLog.at(-1)!.p).toMatchObject({ outcome: 'error', reason: 'watchdog_timeout' }); expect(h.status()).toBe('exited');
  });
  it('activity keeps the watchdog quiet', async () => {
    const r = rig({ engine: { script: { gapMs: 20 * 60_000, events: [{ type: 'status', state: 'a' }, { type: 'status', state: 'b' }, { type: 'status', state: 'c' }] } } }); const h = await r.runner.start(await r.spec()); await settle(r, 70 * 60_000); expect(h.status()).toBe('waiting'); expect(r.busLog.filter((b) => b.name === 'agent:exited')).toHaveLength(0);
  });
});

describe('oversized lines', () => {
  it('an engine that read a line over the cap ends only that agent, with provider_protocol_error', async () => {
    const r = rig({ engine: { script: (_n, s) => (r.engine.sessions.indexOf(s) === 0 ? { oversizeLine: true } : {}) } }); const a = await r.runner.start(await r.spec()); const b = await r.runner.start(await r.spec()); await settle(r);
    expect(a.status()).toBe('exited'); expect(r.busLog.find((x) => x.name === 'agent:exited')!.p).toMatchObject({ agent_id: a.id, outcome: 'error', reason: 'provider_protocol_error' }); expect(b.status()).toBe('waiting'); await b.send('fine'); await settle(r); expect(b.status()).toBe('waiting');
  });
});

describe('approvals', () => {
  const req = (id = 'apr_1') => ({ approval_id: id, agent_id: 'agt_x', tool_id: 't', tool: 'Bash', summary: 's', risk: 'high' as const });
  it('the default gate waits for resolveApproval, and unknown approvals are refused', async () => {
    const r = rig(); const h = await r.runner.start(await r.spec({ prompt: '' })); await settle(r); const d = sess(r).o.approvalGate!.decide(req()); expect(r.runner.resolveApproval(h.id, 'apr_nope', { decision: 'approve' })).toBe(false);
    expect(r.runner.resolveApproval(h.id, 'apr_1', { decision: 'approve', scope: 'session' })).toBe(true); await expect(d).resolves.toEqual({ decision: 'approve', scope: 'session' }); expect(r.runner.resolveApproval(h.id, 'apr_1', { decision: 'approve' })).toBe(false);
    expect(r.busLog.find((b) => b.name === 'agent:approval_resolved')!.p).toMatchObject({ approval_id: 'apr_1', decision: 'allow' });
  });
  it('an unanswered approval is denied after the timeout', async () => {
    const r = rig({ config: { approvalTimeoutMs: 60_000 } }); const h = await r.runner.start(await r.spec({ prompt: '' })); await settle(r); const d = sess(r).o.approvalGate!.decide(req()); void h; await settle(r, 60_000); await expect(d).resolves.toMatchObject({ decision: 'deny', reason: 'timeout' });
  });
  it('stopping an agent denies what it was waiting for', async () => {
    const r = rig(); const h = await r.runner.start(await r.spec({ prompt: '' })); await settle(r); const d = sess(r).o.approvalGate!.decide(req()); await h.stop(); await expect(d).resolves.toMatchObject({ decision: 'deny' });
  });
  it('an injected permission broker replaces the default gate', async () => {
    const seen: string[] = []; const r = rig({ deps: { permissions: { decide: async (q) => { seen.push(q.approval_id); return { decision: 'approve', scope: 'once' }; } } } }); await r.runner.start(await r.spec({ prompt: '' })); await settle(r);
    await expect(sess(r).o.approvalGate!.decide(req('apr_9'))).resolves.toMatchObject({ decision: 'approve' }); expect(seen).toEqual(['apr_9']);
  });
});

describe('what the child gets and what gets logged', () => {
  it('poisoned parent env: only the allow-list passes, only CENTCOM_AGENT_ID of the CENTCOM_ family, provider keys unchanged and never logged', async () => {
    const parent = { PATH: '/usr/bin', HOME: '/home/u', LANG: 'en_US.UTF-8', HTTPS_PROXY: 'http://p:1', ANTHROPIC_API_KEY: 'sk-ant-api03-' + 'a'.repeat(40), CENTCOM_TOKEN: 'ctk_secret', CENTCOM_DEBUG: '1', GITHUB_TOKEN: 'ghp_' + 'b'.repeat(36), AWS_SECRET_ACCESS_KEY: 'c'.repeat(40), NPM_TOKEN: 'npm_' + 'd'.repeat(36), SSH_AUTH_SOCK: '/tmp/ssh', LC_ALL: 'C' };
    const r = rig({ deps: { env: parent } }); const h = await r.runner.start(await r.spec()); await settle(r); await h.stop();
    const env = sess(r).env; expect(sess(r).envExact).toBe(true); expect(Object.keys(env).sort()).toEqual(['ANTHROPIC_API_KEY', 'CENTCOM_AGENT_ID', 'HOME', 'HTTPS_PROXY', 'LANG', 'LC_ALL', 'PATH']); expect(env.CENTCOM_AGENT_ID).toBe(h.id); expect(env.ANTHROPIC_API_KEY).toBe(parent.ANTHROPIC_API_KEY);
    const text = JSON.stringify(r.log); for (const v of Object.values(parent)) if (v.length > 12) expect(text).not.toContain(v); for (const p of SECRET_PATTERNS) expect(new RegExp(p.regex, 'g').test(text), p.id).toBe(false);
  });
  it('logs carry ids, engine, outcomes and counts, and never the prompt, folder or text', async () => {
    const r = rig(); const cwd = await r.dirs(); const h = await r.runner.start({ engine: 'fake', cwd, prompt: 'TOP-SECRET-PROMPT-TEXT', model: 'some-model' }); await settle(r); await h.stop(); const text = JSON.stringify(r.log);
    expect(text).not.toContain('TOP-SECRET'); expect(text).not.toContain(cwd); expect(text).not.toContain('some-model'); expect(r.log.some((l) => l.msg === 'agent.exited')).toBe(true);
  });
});
