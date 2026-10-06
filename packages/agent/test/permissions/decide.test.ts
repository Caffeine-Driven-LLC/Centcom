import { describe, expect, it } from 'vitest';
import { allow, denyRule, req, rig } from './helpers.js';

describe('rule precedence', () => {
  it('deny beats allow: `git push` is denied, `git status` allowed', async () => {
    const r = rig(); await r.rules.add(allow('Bash', { command: 'git *' })); await r.rules.add(denyRule('Bash', { command: 'git push*' }));
    expect((await r.engine.decide(req({ command: 'git push origin x' }), r.ctx)).action).toBe('deny'); expect((await r.engine.decide(req({ command: 'git status' }), r.ctx)).action).toBe('allow');
  });
  it('deny and ask also look at every part of a compound command; allow never matches one', async () => {
    const r = rig(); await r.rules.add(allow('Bash', { command: 'git status:*' })); await r.rules.add(denyRule('Bash', { command: 'rm:*' }));
    expect((await r.engine.decide(req({ command: 'git status; rm -rf x' }), r.ctx)).action).toBe('deny'); expect((await r.engine.decide(req({ command: 'git status && ls' }), r.ctx)).action).toBe('ask'); expect((await r.engine.decide(req({ command: 'git status | cat' }), r.ctx)).action).toBe('ask'); expect((await r.engine.decide(req({ command: 'git status $(echo hi)' }), r.ctx)).action).toBe('ask'); expect((await r.engine.decide(req({ command: 'git status > out.txt' }), r.ctx)).action).toBe('ask');
  });
  it('ask beats allow; the most specific rule in a class is the one named', async () => {
    const r = rig(); await r.rules.add(allow('Bash')); await r.rules.add({ tool: 'Bash', action: 'ask', scope: 'session', matcher: { command: 'npm publish*' } }); expect((await r.engine.decide(req({ command: 'npm publish' }), r.ctx)).action).toBe('ask'); expect((await r.engine.decide(req({ command: 'ls' }), r.ctx)).action).toBe('allow');
    const g = rig(); const a = await g.rules.add(allow('Bash', { command: 'git *' })); const b = await g.rules.add(allow('Bash', { command: 'git status:*' })); expect((await g.engine.decide(req({ command: 'git status' }), g.ctx)).rule).toBe(b.id); void a;
  });
  it('rules are limited to their engine, matched by tool name case-insensitively, and path globs relative to the root', async () => {
    const r = rig(); await r.rules.add({ ...allow('edit', { path_glob: 'src/**' }), engine: 'codex' }); expect((await r.engine.decide(req({ tool: 'Edit', path: 'src/a.ts', command: undefined }), r.ctx)).action).toBe('ask'); // engine is claude-code
    await r.rules.add({ ...allow('edit', { path_glob: 'src/**' }), engine: 'claude-code' }); expect((await r.engine.decide(req({ tool: 'Edit', path: 'src/a.ts', command: undefined }), r.ctx)).action).toBe('allow'); expect((await r.engine.decide(req({ tool: 'Edit', path: 'lib/a.ts', command: undefined }), r.ctx)).action).toBe('ask');
  });
  it('mcp tools match by wildcard and by server', async () => { const r = rig(); await r.rules.add({ tool: 'mcp__github__*', action: 'allow', scope: 'session' }); expect((await r.engine.decide(req({ tool: 'mcp__github__list_prs', command: undefined }), r.ctx)).action).toBe('allow'); expect((await r.engine.decide(req({ tool: 'mcp__slack__post', command: undefined }), r.ctx)).action).toBe('ask'); });
});

describe('modes', () => {
  const read = req({ tool: 'Read', path: 'a.txt', command: undefined }); const edit = req({ tool: 'Edit', path: 'a.txt', command: undefined }); const shell = req({ command: 'ls' });
  it('ask: read inside the root allowed; edit, shell and read outside ask', async () => { const r = rig({ mode: 'ask' }); expect((await r.engine.decide(read, r.ctx)).action).toBe('allow'); expect((await r.engine.decide(edit, r.ctx)).action).toBe('ask'); expect((await r.engine.decide(shell, r.ctx)).action).toBe('ask'); expect((await r.engine.decide({ ...read, path: '/etc/hostname' }, r.ctx)).action).toBe('ask'); });
  it('plan: reads allowed; edit and shell denied with plan_mode', async () => { const r = rig({ mode: 'plan' }); expect((await r.engine.decide(read, r.ctx)).action).toBe('allow'); for (const q of [edit, shell]) expect(await r.engine.decide(q, r.ctx)).toMatchObject({ action: 'deny', reason: 'plan_mode' }); });
  it('accept-edits: edits inside the root allowed, shell asks', async () => { const r = rig({ mode: 'accept-edits' }); expect((await r.engine.decide(edit, r.ctx)).action).toBe('allow'); expect((await r.engine.decide(shell, r.ctx)).action).toBe('ask'); });
  it('auto-low-risk: only risk low is allowed', async () => { const r = rig({ mode: 'auto-low-risk' }); expect((await r.engine.decide({ ...shell, risk: 'low' }, r.ctx)).action).toBe('allow'); for (const k of ['medium', 'high'] as const) expect((await r.engine.decide({ ...shell, risk: k }, r.ctx)).action).toBe('ask'); });
  it('bypass needs the explicit opt-in, and then allows what is not hard-denied', async () => {
    const off = rig({ mode: 'bypass' }); expect((await off.engine.decide(shell, off.ctx)).action).toBe('ask'); expect(off.engine.bypassActive(off.ctx)).toBe(false);
    const on = rig({ mode: 'bypass', config: { bypassEnabled: true } }); expect((await on.engine.decide(shell, on.ctx)).action).toBe('allow'); expect(on.engine.bypassActive(on.ctx)).toBe(true); expect((await on.engine.decide({ ...edit, path: '../escape.txt' }, on.ctx)).action).toBe('deny');
  });
  it('explicit deny rules also apply in bypass; unknown engines and tools never allow', async () => {
    const on = rig({ mode: 'bypass', config: { bypassEnabled: true } }); await on.rules.add(denyRule('Bash', { command: 'rm:*' })); expect((await on.engine.decide(req({ command: 'rm x' }), on.ctx)).action).toBe('deny');
    const r = rig(); expect((await r.engine.decide(shell, { ...r.ctx, engine: 'martian' as never })).action).toBe('ask'); expect((await r.engine.decide(req({ tool: 'BrandNewTool', command: undefined }), r.ctx)).action).toBe('ask');
    const a = rig({ mode: 'auto-low-risk' }); expect((await a.engine.decide(shell, { ...a.ctx, engine: 'martian' as never })).action).toBe('ask');
  });
  it('a stopped agent is always denied', async () => { const r = rig({ mode: 'bypass', config: { bypassEnabled: true } }); expect(await r.engine.decide(read, { ...r.ctx, stopped: true })).toMatchObject({ action: 'deny', reason: 'agent_stopped', hard: true }); });
});
