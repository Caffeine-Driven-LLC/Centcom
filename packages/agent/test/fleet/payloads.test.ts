import { assertWritableEventPayload } from '@centcom/protocol';
import { describe, expect, it } from 'vitest';
import { fleetRig } from './helpers.js';

const OWNER = 'mem_01JTEST0000000000000000001';
describe('wire payloads (acceptance 8)', () => {
  it('agent.spawn: a valid clear part with no label, branch, path or model; those are in the secret part; provider follows the engine', async () => {
    const r = await fleetRig({ limit: 4 }); const claude = await r.fleet.spawn(r.spec(1, { label: 'secret login work', model: 'claude-sonnet-5-5', ownerId: OWNER })); const codex = await r.fleet.spawn(r.spec(2, { engine: 'codex', label: 'other', ownerId: OWNER }));
    await r.until(() => claude.state() === 'waiting' && codex.state() === 'waiting'); const a = r.fleet.spawnPayload(claude); const b = r.fleet.spawnPayload(codex);
    for (const p of [a, b]) { expect(() => assertWritableEventPayload('agent.spawn', p.clear)).not.toThrow(); const clear = JSON.stringify(p.clear); expect(clear).not.toContain('secret'); expect(clear).not.toContain('centcom/'); expect(clear).not.toContain(r.wtRoot); expect(clear).not.toContain('sonnet'); expect(Object.keys(p.clear).sort()).toEqual(['agent_id', 'mode', 'owner', 'provider', 'runs_on']); }
    expect(a.clear).toMatchObject({ provider: 'anthropic', owner: OWNER, mode: 'branch', agent_id: claude.id }); expect(b.clear.provider).toBe('openai'); expect(a.secret).toEqual({ label: 'secret login work', branch: claude.branch, worktree: claude.describe().worktree, model: 'claude-sonnet-5-5' }); expect(b.secret.model).toBeUndefined(); await r.fleet.stopAll();
  }, 60_000);
  it('agent.exit: valid for every outcome, the code in the clear part and the details only in the secret part', async () => {
    const r = await fleetRig({ engineOpts: { 'claude-code': { script: { hang: true } } } }); const h = await r.fleet.spawn(r.spec(1, { ownerId: OWNER })); for (const res of [{ outcome: 'ok' as const, branchReady: false }, { outcome: 'canceled' as const, branchReady: false }, { outcome: 'error' as const, error_code: 'provider_not_signed_in', branchReady: false }]) { const p = r.fleet.exitPayload(h, res); expect(() => assertWritableEventPayload('agent.exit', p.clear)).not.toThrow(); expect(p.clear).toEqual({ agent_id: h.id, outcome: res.outcome, ...(res.error_code ? { error_code: res.error_code } : {}) }); } await r.fleet.stopAll();
    const bad = await fleetRig({ engineOpts: { codex: { failStart: Object.assign(new Error('Please sign in: codex login'), { code: 'provider_not_signed_in' }) } } }); await bad.fleet.spawn(bad.spec(1, { engine: 'codex', ownerId: OWNER })).catch(() => undefined); const node = [...bad.nodes.values()][0]!; const h2 = { id: node.id, describe: () => ({}) } as never; const px = bad.fleet.exitPayload(h2, { outcome: 'error', error_code: 'provider_not_signed_in', branchReady: false }); expect(JSON.stringify(px.clear)).not.toContain('sign in'); expect(px.secret.detail).toContain('Please sign in');
  }, 60_000);
  it('without a known owner the spawn payload is refused instead of guessing', async () => { const r = await fleetRig(); const h = await r.fleet.spawn(r.spec(1)); expect(() => r.fleet.spawnPayload(h)).toThrow(expect.objectContaining({ code: 'no_owner' })); await r.fleet.stopAll(); }, 30_000);
});
