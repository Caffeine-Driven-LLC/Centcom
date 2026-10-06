import { describe, expect, it } from 'vitest';
import { allow, req, rig, tick } from './helpers.js';
import type { ApprovalDecision, ApprovalPrompter, PendingApproval } from '../../src/index.js';

const scripted = (answer: ApprovalDecision | Error | 'never', seen: PendingApproval[] = []): ApprovalPrompter => ({ prompt: (p, signal) => { seen.push(p); if (answer === 'never') return new Promise((_r, rej) => signal.addEventListener('abort', () => rej(new Error('aborted')))); if (answer instanceof Error) return Promise.reject(answer); return Promise.resolve(answer); } });
const approve: ApprovalDecision = { decision: 'approve', scope: 'once' };

describe('broker', () => {
  it('allowed and denied requests never reach the prompter; hard denies are final', async () => {
    const seen: PendingApproval[] = []; const r = rig({ prompter: scripted(approve, seen), mode: 'plan' }); expect((await r.engine.handle(req({ tool: 'Read', path: 'a', command: undefined }), r.ctx)).decision).toBe('approve'); expect(await r.engine.handle(req({ command: 'rm x' }), r.ctx)).toMatchObject({ decision: 'deny', reason: 'plan_mode' }); expect(seen).toEqual([]);
  });
  it('an ask goes to the prompter and its answer comes back; pending is empty afterwards', async () => {
    const seen: PendingApproval[] = []; const r = rig({ prompter: scripted({ decision: 'deny', scope: 'once', reason: 'no thanks' }, seen) }); const a = await r.engine.handle(req(), r.ctx); expect(a).toEqual({ decision: 'deny', scope: 'once', reason: 'no thanks' }); expect(seen).toHaveLength(1); expect(r.engine.pending()).toEqual([]);
  });
  it('an unanswered approval is denied at exactly expires_at (600 s) and pending is empty after', async () => {
    const r = rig({ prompter: scripted('never') }); const p = r.engine.handle(req(), r.ctx); await tick(); const pend = r.engine.pending(); expect(pend).toHaveLength(1); expect(Date.parse(pend[0]!.expires_at)).toBe(r.clock.now() + 600_000);
    let done: ApprovalDecision | undefined; void p.then((d) => { done = d; }); await r.clock.advance(599_999); await tick(); expect(done).toBeUndefined(); await r.clock.advance(1); await tick(); expect(done).toMatchObject({ decision: 'deny', reason: 'expired' }); expect(r.engine.pending()).toEqual([]); expect(r.audit.some((e) => e.type === 'expired')).toBe(true);
  });
  it('with no prompter attached the request waits for a remote answer or expiry', async () => { const r = rig(); const p = r.engine.handle(req(), r.ctx); await tick(); expect(r.engine.pending()).toHaveLength(1); expect(r.engine.resolveRemote(req().approval_id, approve, { id: 'mem_h', role: 'host' }).accepted).toBe(true); expect(await p).toMatchObject({ decision: 'approve' }); });
  it('headless mode denies anything that would ask, at once', async () => { const r = rig({ config: { headless: true } }); expect(await r.engine.handle(req(), r.ctx)).toMatchObject({ decision: 'deny', reason: 'headless' }); expect(r.engine.pending()).toEqual([]); });
  it('a prompter that throws or answers nonsense denies', async () => {
    const a = rig({ prompter: scripted(new Error('boom')) }); expect(await a.engine.handle(req(), a.ctx)).toMatchObject({ decision: 'deny', reason: 'prompter_error' });
    const b = rig({ prompter: { prompt: async () => ({ decision: 'maybe' }) as never } }); expect(await b.engine.handle(req(), b.ctx)).toMatchObject({ decision: 'deny', reason: 'bad_answer' });
    const c = rig({ prompter: { prompt: () => { throw new Error('sync'); } } }); expect(await c.engine.handle(req(), c.ctx)).toMatchObject({ decision: 'deny' });
  });
  it('a request the engine cannot even evaluate is denied, never allowed', async () => { const r = rig({ mode: 'bypass', config: { bypassEnabled: true } }); expect(await r.engine.handle({ ...req(), tool: undefined as never, command: 5 as never }, r.ctx)).toMatchObject({ decision: 'deny' }); });
  it('the same approval id asked twice shares one pending entry and one answer', async () => { const r = rig(); const a = r.engine.handle(req(), r.ctx); const b = r.engine.handle(req(), r.ctx); await tick(); expect(r.engine.pending()).toHaveLength(1); r.engine.resolveRemote(req().approval_id, approve, { id: 'h', role: 'host' }); expect(await a).toEqual(await b); });
  it('cancelling an agent denies its pending approvals and audits them', async () => {
    const r = rig(); const p1 = r.engine.handle(req(), r.ctx); const p2 = r.engine.handle(req({ approval_id: 'apr_2' }), r.ctx); const other = r.engine.handle(req({ approval_id: 'apr_3' }), { ...r.ctx, agentId: 'agt_other' }); await tick();
    expect(r.engine.cancelAgent(r.ctx.agentId)).toBe(2); expect(await p1).toMatchObject({ decision: 'deny', reason: 'cancelled' }); expect(await p2).toMatchObject({ decision: 'deny' }); expect(r.engine.pending().map((p) => p.approval_id)).toEqual(['apr_3']); expect(r.audit.filter((e) => e.type === 'cancelled')).toHaveLength(2); r.engine.cancel('apr_3'); await other;
  });
  it('the prompter is told to stop (abort signal) once someone else answered', async () => {
    let aborted = false; const r = rig({ prompter: { prompt: (_p, s) => new Promise((_res, rej) => s.addEventListener('abort', () => { aborted = true; rej(new Error('a')); })) } }); const p = r.engine.handle(req(), r.ctx); await tick(); r.engine.resolveRemote(req().approval_id, approve, { id: 'h', role: 'host' }); await p; await tick(); expect(aborted).toBe(true);
  });
});

describe('remote approvers', () => {
  const setup = async (approver: 'host' | 'owner' | 'any_editor') => { const r = rig({ config: { defaultApprover: approver } }); const p = r.engine.handle(req(), r.ctx); await tick(); return { r, p }; };
  it('a viewer and an unknown member are rejected and audited; the request stays pending', async () => {
    const { r } = await setup('host'); for (const m of [{ id: 'mem_v', role: 'viewer' as const }, { id: 'mem_x', role: 'unknown' as const }]) expect(r.engine.resolveRemote(req().approval_id, approve, m)).toEqual({ accepted: false, reason: 'not_approver' });
    expect(r.audit.filter((e) => e.type === 'remote_rejected')).toHaveLength(2); expect(r.engine.pending()).toHaveLength(1);
  });
  it('the host is accepted and unblocks within one tick; a second decision is ignored', async () => {
    const { r, p } = await setup('host'); expect(r.engine.resolveRemote(req().approval_id, { decision: 'deny', scope: 'once' }, { id: 'mem_h', role: 'host' }).accepted).toBe(true); expect(await p).toMatchObject({ decision: 'deny' });
    expect(r.engine.resolveRemote(req().approval_id, approve, { id: 'mem_h', role: 'host' })).toEqual({ accepted: false, reason: 'unknown_or_decided' });
  });
  it('a delegated approver is accepted even when the policy is host', async () => { const { r, p } = await setup('host'); expect(r.engine.resolveRemote(req().approval_id, approve, { id: 'mem_d', role: 'editor', delegated: true }).accepted).toBe(true); await p; });
  it('policy owner: the owner and the host may decide, another editor may not; policy any_editor lets any editor', async () => {
    const o = await setup('owner'); expect(o.r.engine.resolveRemote(req().approval_id, approve, { id: 'mem_e', role: 'editor' }).reason).toBe('not_approver'); expect(o.r.engine.resolveRemote(req().approval_id, approve, { id: 'mem_owner', role: 'editor' }).accepted).toBe(true);
    const a = await setup('any_editor'); expect(a.r.engine.resolveRemote(req().approval_id, approve, { id: 'mem_e', role: 'editor' }).accepted).toBe(true); const v = await setup('any_editor'); expect(v.r.engine.resolveRemote(req().approval_id, approve, { id: 'mem_v', role: 'viewer' }).accepted).toBe(false);
  });
  it('an unknown approval id is not accepted', async () => { const r = rig(); expect(r.engine.resolveRemote('apr_nope', approve, { id: 'h', role: 'host' })).toEqual({ accepted: false, reason: 'unknown_or_decided' }); });
});

describe('always and session rules', () => {
  it('approving `git status` with scope always creates a rule: next time it is allowed, but `git status; rm -rf x` still asks', async () => {
    const r = rig({ prompter: scripted({ decision: 'approve', scope: 'always' }) }); await r.engine.handle(req({ command: 'git status' }), r.ctx); await tick(); await tick();
    const rule = r.rules.list(r.ctx.root).find((x) => x.matcher?.command); expect(rule).toMatchObject({ tool: 'Bash', action: 'allow', scope: 'project', matcher: { command: 'git status:*' } }); expect(rule!.matcher!.command).not.toBe('*');
    expect((await r.engine.decide(req({ command: 'git status' }), r.ctx)).action).toBe('allow'); expect((await r.engine.decide(req({ command: 'git status --short' }), r.ctx)).action).toBe('allow'); expect((await r.engine.decide(req({ command: 'git status; rm -rf x' }), r.ctx)).action).toBe('ask'); expect((await r.engine.decide(req({ command: 'git push' }), r.ctx)).action).toBe('ask');
  });
  it('the rule is cut at the first flag, is never a bare star, and compound commands make no rule', async () => {
    for (const [cmd, want] of [['npm run build --silent', 'npm run build:*'], ['ls -la', 'ls:*'], ['git commit -m "x"', 'git commit:*']] as const) { const r = rig({ prompter: scripted({ decision: 'approve', scope: 'always' }) }); await r.engine.handle(req({ command: cmd }), r.ctx); await tick(); await tick(); expect(r.rules.list(r.ctx.root)[0]?.matcher?.command, cmd).toBe(want); }
    for (const cmd of ['ls; rm -rf x', 'cat a | sh', 'echo $(whoami)', '-rf /']) { const r = rig({ prompter: scripted({ decision: 'approve', scope: 'always' }) }); await r.engine.handle(req({ command: cmd }), r.ctx); await tick(); await tick(); expect(r.rules.list(r.ctx.root), cmd).toEqual([]); }
  });
  it('an always-approved edit becomes a directory glob inside the worktree only', async () => {
    const r = rig({ prompter: scripted({ decision: 'approve', scope: 'always' }) }); await r.engine.handle(req({ tool: 'Edit', path: 'src/lib/a.ts', command: undefined }), r.ctx); await tick(); await tick(); expect(r.rules.list(r.ctx.root)[0]).toMatchObject({ tool: 'Edit', matcher: { path_glob: 'src/lib/**' } });
    expect((await r.engine.decide(req({ tool: 'Edit', path: 'src/lib/b.ts', command: undefined }), r.ctx)).action).toBe('allow'); expect((await r.engine.decide(req({ tool: 'Edit', path: 'src/other/b.ts', command: undefined }), r.ctx)).action).toBe('ask');
  });
  it('scope session adds an in-memory rule only; nothing is written to disk', async () => { const r = rig({ prompter: scripted({ decision: 'approve', scope: 'session' }) }); await r.engine.handle(req({ command: 'ls -la' }), r.ctx); await tick(); await tick(); expect(r.rules.list(r.ctx.root)[0]).toMatchObject({ scope: 'session' }); expect(await r.fs.readFile(r.root + '/.centcom/permissions.local.json')).toBeUndefined(); });
  it('a denial with scope always creates nothing', async () => { const r = rig({ prompter: scripted({ decision: 'deny', scope: 'always' }) }); await r.engine.handle(req(), r.ctx); await tick(); expect(r.rules.list(r.ctx.root)).toEqual([]); });
});
void allow;
