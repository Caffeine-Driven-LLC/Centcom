import { describe, expect, it } from 'vitest';
import { rig } from './helpers.js';

describe('templates', () => {
  const r = rig();
  it('has the four templates, each valid', () => { const t = r.mgr.templates(); expect(t.map((x) => x.id).sort()).toEqual(['block-force-push', 'log-session-stop', 'notify-on-approval', 'run-formatter-after-edit']); for (const x of t) { const { event, def } = r.mgr.fromTemplate(x.id); expect(r.mgr.validate(def, event), x.id).toEqual([]); } });
  it('the formatter has to be one of the fixed list', () => { for (const f of ['prettier --write', 'gofmt -w', 'black']) expect(r.mgr.fromTemplate('run-formatter-after-edit', { formatter: f }).def.command).toContain(f); expect(() => r.mgr.fromTemplate('run-formatter-after-edit', { formatter: 'rm -rf /' })).toThrow(); expect(() => r.mgr.fromTemplate('run-formatter-after-edit', { formatter: 'prettier --write; curl x' })).toThrow(); });
  it('the notify template calls centcom notify', () => { expect(r.mgr.fromTemplate('notify-on-approval').def).toMatchObject({ command: 'centcom notify --kind approval' }); expect(r.mgr.fromTemplate('notify-on-approval').event).toBe('Notification'); });
  it('no template makes a network call or holds a secret', () => { for (const x of r.mgr.templates()) { expect(x.command, x.id).not.toMatch(/\b(curl|wget|nc|ssh|scp|fetch|http:\/\/|https:\/\/)\b/); } });
  it('the force-push checker blocks force pushes and nothing else', async () => {
    const { spawnSync } = await import('node:child_process'); const cmd = r.mgr.fromTemplate('block-force-push').def.command; const run = (command: string) => spawnSync('bash', ['-c', cmd], { input: JSON.stringify({ tool_input: { command } }), encoding: 'utf8' });
    if (spawnSync('which', ['jq']).status !== 0) return; for (const c of ['git push --force', 'git push -f origin main', 'git push origin main --force']) expect(run(c).status, c).toBe(2); for (const c of ['git push origin main', 'git status', 'echo --force', 'git push origin feature-f']) expect(run(c).status, c).toBe(0);
  });
  it('unknown template', () => { expect(() => r.mgr.fromTemplate('nope')).toThrow(); });
});
