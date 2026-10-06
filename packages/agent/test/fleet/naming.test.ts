import { describe, expect, it } from 'vitest';
import { BRANCH_RE, id6, labelSlug } from '../../src/index.js';
import { fleetRig, sh } from './helpers.js';

describe('naming and worktree binding (acceptance 2)', () => {
  it('branches match the pattern, two agents with the same label get different ones, labels are cleaned', async () => {
    const r = await fleetRig({ limit: 8 }); const hs = [await r.fleet.spawn(r.spec(1, { label: 'Fix the Login Bug!' })), await r.fleet.spawn(r.spec(2, { label: 'same' })), await r.fleet.spawn(r.spec(3, { label: 'same' })), await r.fleet.spawn(r.spec(4, { label: 'ÄÖÜ ünïcode ' + 'x'.repeat(100), ownerSlug: 'Alex Gese' })), await r.fleet.spawn(r.spec(5, { label: '' })), await r.fleet.spawn(r.spec(6, { label: '!!!' }))];
    await r.until(() => r.count('running') + r.count('waiting') === 6); const branches = hs.map((h) => h.branch!); for (const b of branches) expect(b, b).toMatch(BRANCH_RE); expect(new Set(branches).size).toBe(6);
    expect(branches[0]).toMatch(/^centcom\/alex\/fix-the-login-bug-[a-z0-9]{6}$/); expect(branches[1]).not.toBe(branches[2]); expect(branches[3]).toMatch(/^centcom\/alex-gese\/aou-unicode-x+-[a-z0-9]{6}$/); expect(branches[4]).toMatch(/-[a-z0-9]{6}$/); expect(branches[4]).toContain('agent-5');
    for (const [i, h] of hs.entries()) expect(branches[i]!.endsWith(`-${id6(h.id)}`)).toBe(true); await r.fleet.stopAll();
  }, 60_000);
  it('each engine process starts in its own worktree: distinct folders, inside the worktree root, never the repo itself', async () => {
    const r = await fleetRig({ limit: 8 }); const hs = []; for (let i = 1; i <= 5; i++) hs.push(await r.fleet.spawn(r.spec(i)));
    await r.until(() => r.engines['claude-code']!.sessions.length === 5); const cwds = r.engines['claude-code']!.sessions.map((s) => s.o.cwd); expect(new Set(cwds).size).toBe(5); for (const c of cwds) { expect(c.startsWith(r.wtRoot)).toBe(true); expect(c).not.toBe(r.repo); }
    for (const [i, h] of hs.entries()) { expect(h.describe().worktree).toBe(cwds[i]); expect(sh(cwds[i]!, 'rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe(h.branch); } await r.fleet.stopAll();
  }, 60_000);
  it('labelSlug and id6', () => { expect(labelSlug('Hello World', 1)).toBe('hello-world'); expect(labelSlug('日本語', 3)).toBe('agent-3'); expect(labelSlug('a'.repeat(80), 1)).toHaveLength(48); expect(id6('agt_01JTEST0000000000000000AB1')).toBe('00000ab1'.slice(2).toLowerCase()); });
});
