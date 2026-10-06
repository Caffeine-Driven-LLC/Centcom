import { mkdirSync, statSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseEventPayload, parseSecretPayload } from '@centcom/protocol';
import { approvalToWire, validateRules } from '../../src/index.js';
import { allow, req, rig, tick } from './helpers.js';

const file = (path: string, rules: unknown) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, typeof rules === 'string' ? rules : JSON.stringify({ v: 1, rules })); };
const goodRule = { id: 'rul_1', tool: 'Bash', action: 'allow', scope: 'user', created_at: '2026-10-06T00:00:00Z', matcher: { command: 'git status:*' } };

describe('persistence', () => {
  it('user rules are written 0600 and load again', async () => {
    const r = rig(); await r.rules.add({ tool: 'Bash', action: 'deny', scope: 'user', matcher: { command: 'rm:*' } }); expect(statSync(r.userRulesPath).mode & 0o777).toBe(0o600); const again = rig(); void again;
    await r.rules.loadUser(); expect(r.rules.list()).toHaveLength(1); expect(JSON.parse(readFileSync(r.userRulesPath, 'utf8')).v).toBe(1);
  });
  it('a corrupted file gives zero allow rules, a warning, and the engine keeps asking', async () => {
    for (const bad of ['{ not json', JSON.stringify({ v: 2, rules: [] }), JSON.stringify({ v: 1, rules: [goodRule, { ...goodRule, action: 'maybe' }] }), JSON.stringify({ v: 1, rules: [{ ...goodRule, tool: '' }] }), '[]', JSON.stringify({ v: 1, rules: [{ ...goodRule, matcher: { command: 5 } }] })]) {
      const r = rig(); file(r.userRulesPath, bad); await r.rules.loadUser(); expect(r.rules.list(), bad).toEqual([]); expect(r.rules.warnings().length, bad).toBe(1); expect((await r.engine.decide(req({ command: 'git status' }), r.ctx)).action).toBe('ask'); expect(r.audit.some((e) => e.type === 'rules_warning')).toBe(true);
    }
  });
  it('a valid file with one invalid rule is ignored whole (no half-trusted file)', async () => { const r = rig(); file(r.userRulesPath, [goodRule, { id: 'x' }]); await r.rules.loadUser(); expect(r.rules.list()).toEqual([]); });
  it('validateRules accepts the shape it writes', () => { expect(validateRules({ v: 1, rules: [goodRule] })).toHaveLength(1); expect(validateRules(null)).toBeUndefined(); expect(validateRules({ v: 1, rules: 'x' })).toBeUndefined(); });
  it('a project rules file nobody trusted is not loaded and is listed in needsTrust; after trusting it is', async () => {
    const r = rig(); const p = join(r.root, '.centcom', 'permissions.local.json'); file(p, [{ ...goodRule, scope: 'project' }]); const res = await r.rules.loadProject(r.root); expect(res).toEqual({ loaded: false, needsTrust: true }); expect(r.rules.list(r.root)).toEqual([]); expect(r.rules.needsTrust()).toEqual([r.root]); expect((await r.engine.decide(req({ command: 'git status' }), r.ctx)).action).toBe('ask');
    await r.rules.trustProject(r.root); expect(r.rules.needsTrust()).toEqual([]); expect(r.rules.list(r.root)).toHaveLength(1); expect((await r.engine.decide(req({ command: 'git status' }), r.ctx)).action).toBe('allow');
  });
  it('editing a trusted project file makes it untrusted again (the hash changed)', async () => {
    const r = rig(); const p = join(r.root, '.centcom', 'permissions.local.json'); file(p, [{ ...goodRule, scope: 'project' }]); await r.rules.trustProject(r.root); file(p, [{ ...goodRule, scope: 'project', tool: 'Edit' }]); expect((await r.rules.loadProject(r.root)).needsTrust).toBe(true); expect(r.rules.list(r.root)).toEqual([]);
  });
  it('rules Centcom wrote itself into the project file are trusted at once, written 0600, and the folder is excluded from git', async () => {
    const r = rig(); await r.rules.add(allow('Bash', { command: 'ls:*' }) && { tool: 'Bash', action: 'allow', scope: 'project', matcher: { command: 'ls:*' } }, r.root); const p = join(r.root, '.centcom', 'permissions.local.json'); expect(statSync(p).mode & 0o777).toBe(0o600); expect(readFileSync(join(r.root, '.git', 'info', 'exclude'), 'utf8')).toContain('/.centcom/');
    const fresh = rig({ root: r.root }); void fresh; const again = await r.rules.loadProject(r.root); expect(again).toEqual({ loaded: true, needsTrust: false });
  });
  it('a missing file is simply no rules; remove() deletes from the right place', async () => { const r = rig(); expect(await r.rules.loadProject(r.root)).toEqual({ loaded: true, needsTrust: false }); const a = await r.rules.add({ tool: 'X', action: 'allow', scope: 'session' }); const b = await r.rules.add({ tool: 'Y', action: 'allow', scope: 'user' }); expect(await r.rules.remove(a.id)).toBe(true); expect(await r.rules.remove(b.id)).toBe(true); expect(await r.rules.remove('rul_nope')).toBe(false); expect(r.rules.list()).toEqual([]); });
  it('a project rule needs a folder', async () => { const r = rig(); await expect(r.rules.add({ tool: 'X', action: 'allow', scope: 'project' })).rejects.toThrow(); });
});

describe('wire shape', () => {
  it('the clear part validates and holds no command text or paths; the secret part validates', async () => {
    const r = rig(); const p = r.engine.handle(req({ command: 'rm -rf build/secret-project', cwd: '/home/u/secret-project', summary: 'Delete the project' }), r.ctx); await tick(); const w = approvalToWire(r.engine.pending()[0]!);
    expect(parseEventPayload('approval.request', w.p).ok).toBe(true); expect(parseSecretPayload('approval.request', w.ct).ok).toBe(true); expect(Object.keys(w.p).sort()).toEqual(['agent_id', 'approval_id', 'approver', 'expires_at', 'risk']); expect(JSON.stringify(w.p)).not.toMatch(/secret|rm -rf|\/home|\/srv/); expect(w.ct).toMatchObject({ command: 'rm -rf build/secret-project', cwd: '/home/u/secret-project' });
    r.engine.cancel(req().approval_id); await p;
  });
});
