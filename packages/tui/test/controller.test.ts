import { describe, expect, it } from 'vitest';
import { DemoEngine, type ApprovalRequest } from '@centcom/agent';
import { AppController } from '../src/controller.js';

const req = (id: string, over: Partial<ApprovalRequest> = {}): ApprovalRequest => ({ approval_id: id, agent_id: 'me', tool_id: 't' + id, tool: 'Bash', summary: 'x', risk: 'medium', command: 'npm test', ...over });
const make = (mode?: any) => new AppController({ engine: new DemoEngine({ speed: 100 }), demo: true, cwd: '/tmp', version: 't', skills: [], permissionMode: mode });

describe('approval queue', () => {
  it('shows approvals one at a time, in arrival order, and resolves each independently', async () => {
    const c = make(); const a = c.decide(req('1')); const b = c.decide(req('2', { command: 'ls -la; npm i' }));
    expect(c.state.approvals.map((x) => x.req.approval_id)).toEqual(['1', '2']);
    c.answerApproval('deny'); expect(await a).toMatchObject({ decision: 'deny' }); expect(c.state.approvals.map((x) => x.req.approval_id)).toEqual(['2']);
    c.answerApproval('approve'); expect(await b).toMatchObject({ decision: 'approve' }); expect(c.state.approvals).toHaveLength(0);
  });
  it('remembers "always this session" for the same command but never for high risk', async () => {
    const c = make(); const a = c.decide(req('1')); c.answerApproval('approve', 'session'); await a;
    expect(await c.decide(req('2'))).toMatchObject({ decision: 'approve' }); expect(c.state.approvals).toHaveLength(0); // auto-approved
    const h = c.decide(req('3', { risk: 'high', command: 'rm -rf x' })); expect(c.state.approvals).toHaveLength(1); c.answerApproval('deny'); await h;
    c.answerApproval('approve', 'session'); // nothing pending: must be a no-op
    const h2 = c.decide(req('4', { risk: 'high', command: 'rm -rf x' })); expect(c.state.approvals).toHaveLength(1); c.answerApproval('deny'); await h2;
  });
  it('plan mode denies writes without asking, accept-edits auto-approves edits but still asks for commands', async () => {
    const plan = make('plan'); expect(await plan.decide(req('1', { tool: 'Edit', path: 'a' }))).toMatchObject({ decision: 'deny' }); expect(plan.state.approvals).toHaveLength(0);
    const ae = make('acceptEdits'); expect(await ae.decide(req('2', { tool: 'Edit', path: 'a' }))).toMatchObject({ decision: 'approve' });
    void ae.decide(req('3')); expect(ae.state.approvals).toHaveLength(1);
  });
  it('interrupt denies everything that is waiting', async () => {
    const c = make(); const a = c.decide(req('1')); const b = c.decide(req('2')); c.patch({ busy: true });
    await c.interrupt(); expect(await a).toMatchObject({ decision: 'deny', reason: 'interrupt' }); expect(await b).toMatchObject({ decision: 'deny' }); expect(c.state.approvals).toHaveLength(0);
  });
  it('bypass mode approves everything, even destructive commands, and says so loudly', async () => {
    const c = make(); c.setMode('bypassPermissions');
    expect(await c.decide(req('1', { risk: 'high', command: 'rm -rf /tmp/x' }))).toMatchObject({ decision: 'approve' }); expect(c.state.approvals).toHaveLength(0);
    expect(c.state.items.some((i) => i.kind === 'notice' && i.level === 'warn' && /skip permissions/i.test(i.text))).toBe(true);
    c.setMode('default'); void c.decide(req('2', { risk: 'high', command: 'rm -rf /tmp/x' })); expect(c.state.approvals).toHaveLength(1); // approvals are back
  });
  it('bypass is only reachable by Shift+Tab when explicitly allowed, but /mode aliases always work', async () => {
    const c = make(); c.cycleMode(); c.cycleMode(); c.cycleMode(); expect(c.state.settings.permissionMode).toBe('default'); // default > edits > plan > default
    await c.runCommand('/mode yolo'); expect(c.state.settings.permissionMode).toBe('bypassPermissions');
    c.cycleMode(); expect(c.state.settings.permissionMode).toBe('default'); // leaving bypass is one key
    const d = new AppController({ engine: new DemoEngine({ speed: 100 }), demo: true, cwd: '/tmp', version: 't', skills: [], dangerous: true });
    d.cycleMode(); d.cycleMode(); d.cycleMode(); expect(d.state.settings.permissionMode).toBe('bypassPermissions');
  });
});

describe('interrupt (lane C030)', () => {
  it('the partial answer is kept and marked, a late question from the stopped turn is refused, and the next turn asks normally', async () => {
    const c = make(); const me = (c as any).me as string; (c as any).currentTurn = 'trn_1';
    c.patch({ busy: true, items: [{ kind: 'assistant', id: 'a1', messageId: 'm', agentId: me, text: 'Half an ans', done: false }] }); await c.interrupt();
    expect(c.state.items[0]).toMatchObject({ done: true, interrupted: true, text: 'Half an ans' }); expect(c.state.busy).toBe(false);
    expect(await c.decide(req('late', { agent_id: me }))).toMatchObject({ decision: 'deny', reason: 'interrupt' }); expect(c.state.approvals).toHaveLength(0);
    (c as any).currentTurn = 'trn_2'; void c.decide(req('next', { agent_id: me })); expect(c.state.approvals).toHaveLength(1);
  });
  it('ctrl+c twice during a turn quits with 130; idle, it asks first', async () => {
    const exits: (number | undefined)[] = []; const c = new AppController({ engine: new DemoEngine({ speed: 100 }), demo: true, cwd: '/tmp', version: 't', skills: [], onExit: (code) => exits.push(code) });
    c.ctrlC(); expect(exits).toEqual([]); c.ctrlC(); expect(exits).toEqual([0]);
    c.patch({ busy: true }); c.ctrlC(); expect(exits).toEqual([0]); c.ctrlC(); expect(exits).toEqual([0, 130]);
  });
});
