import { mkdir, mkdtemp, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FakeEngine, type FakeSession } from '@centcom/testkit';
import type { ApprovalDecision } from '../../src/index.js';
import { flush, rig, settle } from './helpers.js';

const sess = (r: ReturnType<typeof rig>, i = 0) => r.engine.sessions[i] as FakeSession;
const req = (id = 'apr_1') => ({ approval_id: id, agent_id: 'agt_x', tool_id: 't', tool: 'Bash', summary: 's', risk: 'high' as const });

describe('queued prompts after an on-crash restart', () => {
  it('are sent in order and a later send() queues behind them', async () => {
    const r = rig({ engine: { script: (_n, s) => (s.o.resume ? {} : { hang: true }) } }); const h = await r.runner.start(await r.spec({ restart: 'on-crash', prompt: 'first' })); await settle(r);
    await h.send('a'); await h.send('b'); sess(r, 0).crash(); await settle(r, 1001); expect(r.engine.starts).toHaveLength(2);
    await h.send('c'); await settle(r, 10); expect(sess(r, 1).prompts).toEqual(['a', 'b', 'c']);
  });
});

describe('failed initial dispatch', () => {
  class SendFails extends FakeEngine { override async start(o: Parameters<FakeEngine['start']>[0]) { const s = (await super.start(o)) as FakeSession; s.send = async () => { throw new Error('boom'); }; return s; } }
  it('emits agent:exited (error, start_failed) after agent:started, so listeners drop the agent', async () => {
    const r = rig({ engines: { fake: new SendFails({}) } }); await expect(r.runner.start(await r.spec({ prompt: 'go' }))).rejects.toThrow('boom'); await settle(r);
    const names = r.busLog.filter((b) => b.name === 'agent:started' || b.name === 'agent:exited'); expect(names.map((b) => b.name)).toEqual(['agent:started', 'agent:exited']);
    expect(names[1]!.p).toMatchObject({ outcome: 'error', reason: 'start_failed' }); expect(r.runner.list().every((a) => a.status !== 'waiting' && a.status !== 'running')).toBe(true);
  });
  it('emits no exited event for a failure before agent:started', async () => {
    const r = rig({ engine: { failStart: new Error('nope') } }); await expect(r.runner.start(await r.spec())).rejects.toThrow('nope'); await settle(r);
    expect(r.busLog.filter((b) => b.name === 'agent:started' || b.name === 'agent:exited')).toHaveLength(0);
  });
});

describe('cwd_in_use compares real folders', () => {
  it('a trailing slash and a symlink to the same folder are the same folder', async () => {
    const r = rig(); const cwd = await r.dirs(); await r.runner.start({ engine: 'fake', cwd, prompt: '' });
    await expect(r.runner.start({ engine: 'fake', cwd: cwd + '/', prompt: '' })).rejects.toMatchObject({ code: 'cwd_in_use' });
    const link = join(await mkdtemp(join(tmpdir(), 'cc-link-')), 'l'); await symlink(cwd, link);
    await expect(r.runner.start({ engine: 'fake', cwd: link, prompt: '' })).rejects.toMatchObject({ code: 'cwd_in_use' });
    await expect(r.runner.start({ engine: 'fake', cwd: join(cwd, '..', cwd.split('/').pop()!), prompt: '' })).rejects.toMatchObject({ code: 'cwd_in_use' });
    const other = await r.dirs(); await expect(r.runner.start({ engine: 'fake', cwd: other, prompt: '' })).resolves.toBeDefined();
  });
  it('case differences count on darwin and win32 but not on linux', async () => {
    for (const [platform, same] of [['darwin', true], ['win32', true], ['linux', false]] as const) {
      const r = rig({ deps: { platform } }); const cwd = await r.dirs(); await mkdir(cwd.toUpperCase(), { recursive: true }).catch(() => undefined); await r.runner.start({ engine: 'fake', cwd, prompt: '' });
      const p = r.runner.start({ engine: 'fake', cwd: cwd.toUpperCase(), prompt: '' });
      if (same) await expect(p).rejects.toMatchObject({ code: 'cwd_in_use' }); else await expect(p).rejects.not.toMatchObject({ code: 'cwd_in_use' });
    }
  });
});

describe('pending approvals with an injected broker', () => {
  const never = () => new Promise<ApprovalDecision>(() => undefined);
  it('stop() calls broker.cancel for approvals asked through decide()', async () => {
    const cancelled: string[] = []; const r = rig({ deps: { permissions: { decide: never, cancel: (id: string) => { cancelled.push(id); } } } }); const h = await r.runner.start(await r.spec({ prompt: '' })); await settle(r);
    void sess(r).o.approvalGate!.decide(req('apr_1')); await h.stop(); expect(cancelled).toEqual(['apr_1']);
  });
  it('a crash cancels approvals the runner saw as approval.requested events, and resolved ones are not cancelled', async () => {
    const cancelled: string[] = []; const ev = (id: string) => ({ type: 'approval.requested' as const, approval_id: id, tool_id: 't', summary: 's', risk: 'high' as const });
    const r = rig({ engine: { script: { hang: true, events: [ev('apr_1'), ev('apr_2'), { type: 'approval.resolved', approval_id: 'apr_2', decision: 'approve', scope: 'once', by: 'user' }] } }, deps: { permissions: { decide: never, cancel: (id: string) => { cancelled.push(id); } } } });
    await r.runner.start(await r.spec({ prompt: 'go' })); await settle(r); sess(r).crash(); await settle(r); expect(cancelled).toEqual(['apr_1']);
  });
  it('a broker without cancel() is fine', async () => {
    const r = rig({ deps: { permissions: { decide: never } } }); const h = await r.runner.start(await r.spec({ prompt: '' })); await settle(r); void sess(r).o.approvalGate!.decide(req()); await expect(h.stop()).resolves.toBeUndefined();
  });
});

describe('stopAll graceMs', () => {
  it('kills what is still running when the grace runs out', async () => {
    const r = rig({ engine: { script: { hang: true, ignoreInterrupt: true, ignoreTerm: true } } }); await Promise.all([1, 2].map(async () => r.runner.start(await r.spec()))); await settle(r);
    const t0 = r.clock.now(); let done = false; const p = r.runner.stopAll({ graceMs: 1000 }).then(() => { done = true; }); await settle(r, 999); expect(done).toBe(false); await settle(r, 2); await p; await flush();
    expect(r.clock.now() - t0).toBeLessThan(1100); expect(r.engine.sessions.every((s) => s.signals.includes('SIGKILL'))).toBe(true); expect(r.busLog.filter((b) => b.name === 'agent:exited')).toHaveLength(2);
  });
  it('without graceMs the normal escalation still applies', async () => {
    const r = rig(); const h = await r.runner.start(await r.spec({ prompt: '' })); await settle(r); await r.runner.stopAll(); expect(h.status()).toBe('exited');
  });
});
