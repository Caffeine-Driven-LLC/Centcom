import { describe, expect, it } from 'vitest';
import { FMT, P, ROOT, SETTINGS, rig } from './helpers.js';

const op = (o: object) => ({ kind: 'add' as const, engine: 'claude-code' as const, scope: 'project' as const, event: 'PostToolUse', root: ROOT, ...o });
describe('acceptance 1: only hooks.PostToolUse changes', () => {
  it('adds the formatter template, keeps every other byte, and backs up', async () => {
    const r = rig({ [P.project]: SETTINGS }); const t = r.mgr.fromTemplate('run-formatter-after-edit', { formatter: 'prettier --write' }); const plan = await r.mgr.plan(op({ event: t.event, def: t.def }));
    expect(plan.diff).toContain('+  "hooks"'); const removed = plan.diff.split('\n').filter((l) => l.startsWith('-') && !l.startsWith('---')); expect(removed).toEqual(['-  "env": {"A":"1"}']); // only the line that needed a comma
    expect(plan.newText.startsWith(SETTINGS.slice(0, SETTINGS.lastIndexOf('\n}')))).toBe(true); // everything that was there is still there, byte for byte
    expect(JSON.parse(plan.newText)).toEqual({ ...JSON.parse(SETTINGS), hooks: { PostToolUse: [{ matcher: 'Edit|Write', hooks: [{ type: 'command', command: FMT.command, timeout: 60 }] }] } });
    expect(r.counts.writes).toBe(0); const rep = await r.mgr.apply(plan, { accepted: true, planHash: plan.planHash });
    expect(r.files.get(P.project)).toBe(plan.newText); expect(rep.backup).toMatch(/settings\.json\.centcom-bak\.\d{14}$/); expect(r.files.get(rep.backup!)).toBe(SETTINGS);
  });
  it('shows the full command in the diff', async () => { const r = rig({ [P.project]: SETTINGS }); const plan = await r.mgr.plan(op({ def: FMT })); expect(plan.diff).toContain('xargs prettier --write'); expect(plan.warnings[0]).toContain('xargs prettier --write'); });
  it('creates a missing file with only hooks', async () => { const r = rig(); const plan = await r.mgr.plan(op({ def: FMT })); expect(plan.baseSha).toBeNull(); expect(Object.keys(JSON.parse(plan.newText))).toEqual(['hooks']); const rep = await r.mgr.apply(plan, { accepted: true, planHash: plan.planHash }); expect(rep.backup).toBeUndefined(); expect(r.files.has(P.project)).toBe(true); });
  it('leaves formatting of other events alone when one changes', async () => {
    const text = '{\n\t"hooks": {\n\t\t"Stop": [{"hooks":[{"type":"command","command":"echo a"}]}],\n\t\t"PostToolUse": [ ]\n\t},\n\t"x": 1\n}'; const r = rig({ [P.project]: text });
    const plan = await r.mgr.plan(op({ event: 'Notification', def: { command: 'echo n' } })); const kept = '"Stop": [{"hooks":[{"type":"command","command":"echo a"}]}],\n\t\t"PostToolUse": [ ]'; expect(plan.newText).toContain(kept); expect(plan.newText).toContain('\t"x": 1\n}'); expect(JSON.parse(plan.newText).hooks.Notification).toHaveLength(1);
  });
  it('update and remove address hooks by position and drop empty groups', async () => {
    const r = rig({ [P.project]: '{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"a"},{"type":"command","command":"b"}]},{"matcher":"x","hooks":[{"type":"command","command":"c"}]}]}}' });
    const l = await r.mgr.list(ROOT); if (!l.claude.supported) throw new Error('x'); expect(l.claude.entries.map((e) => [e.event, e.index, e.def.command])).toEqual([['Stop', 0, 'a'], ['Stop', 1, 'b'], ['Stop', 2, 'c']]);
    let plan = await r.mgr.plan(op({ kind: 'update', event: 'Stop', index: 1, def: { command: 'b2', matcher: 'M', timeout_s: 5 } })); expect(JSON.parse(plan.newText).hooks.Stop).toEqual([{ hooks: [{ type: 'command', command: 'a' }] }, { matcher: 'M', hooks: [{ type: 'command', command: 'b2', timeout: 5 }] }, { matcher: 'x', hooks: [{ type: 'command', command: 'c' }] }]);
    plan = await r.mgr.plan(op({ kind: 'remove', event: 'Stop', index: 2 })); expect(JSON.parse(plan.newText).hooks.Stop).toEqual([{ hooks: [{ type: 'command', command: 'a' }, { type: 'command', command: 'b' }] }]);
    await expect(r.mgr.plan(op({ kind: 'remove', event: 'Stop', index: 9 }))).rejects.toMatchObject({ code: 'not_found' });
  });
  it('removing the last hook of an event removes the event, and keeps the rest', async () => { const r = rig({ [P.project]: '{\n  "a": 1,\n  "hooks": {\n    "Stop": [{"hooks":[{"type":"command","command":"a"}]}]\n  }\n}' }); const plan = await r.mgr.plan(op({ kind: 'remove', event: 'Stop', index: 0 })); expect(JSON.parse(plan.newText)).toEqual({ a: 1, hooks: {} }); });
  it('keeps unknown fields on a hook that is updated', async () => { const r = rig({ [P.project]: '{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"a","extra":true}]}]}}' }); const plan = await r.mgr.plan(op({ kind: 'update', event: 'Stop', index: 0, def: { command: 'b' } })); expect(JSON.parse(plan.newText).hooks.Stop[0].hooks[0]).toEqual({ type: 'command', command: 'b', extra: true }); });
  it('lists the three scopes with their paths', async () => { const r = rig({ [P.project]: '{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"a"}]}]}}', [P.local]: '{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"b"}]}]}}', [P.user]: '{}' }); const l = await r.mgr.list(ROOT); if (!l.claude.supported) throw new Error('x'); expect(l.claude.entries.map((e) => [e.scope, e.path])).toEqual([['project', P.project], ['local', P.local]]); });
  it('says when the installed version could not be checked', async () => { const r = rig({ [P.project]: '{}' }, { caps: false }); const l = await r.mgr.list(ROOT); expect(l.claude).toMatchObject({ supported: true, banner: 'unverified_version' }); });
});
