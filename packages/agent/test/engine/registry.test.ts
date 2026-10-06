import { describe, expect, it } from 'vitest';
import { ProviderError, createEngineRegistry, requireCapability, type AgentEngine, type EngineId } from '../../src/index.js';

const eng = (id: EngineId): AgentEngine => ({ id, provider: 'other', label: id, capabilities: () => new Set(), start: async () => { throw new Error('unused'); } });
const mk = (o: { enabled?: (id: EngineId) => boolean; cfg?: EngineId; installed?: EngineId[]; register?: EngineId[] } = {}) => {
  const probes: EngineId[] = []; const r = createEngineRegistry({ isEngineEnabled: o.enabled ?? (() => true), config: { get: () => o.cfg }, probe: async (id) => { probes.push(id); return { installed: (o.installed ?? ['claude-code', 'codex']).includes(id) }; } });
  for (const id of o.register ?? ['claude-code', 'codex']) r.register(eng(id)); return { r, probes };
};

describe('registry', () => {
  it('registers, gets and lists; an unknown engine is provider_not_installed', () => { const { r } = mk(); expect(r.list().map((e) => e.id)).toEqual(['claude-code', 'codex']); expect(r.get('codex').id).toBe('codex'); expect(() => r.get('fake')).toThrowError(expect.objectContaining({ code: 'provider_not_installed' })); });
  it('select() prefers claude-code when installed, codex when only codex is', async () => { expect((await mk().r.select()).id).toBe('claude-code'); expect((await mk({ installed: ['codex'] }).r.select()).id).toBe('codex'); });
  it('precedence: explicit option beats config, config beats installed order', async () => { expect((await mk({ cfg: 'codex' }).r.select()).id).toBe('codex'); expect((await mk({ cfg: 'codex' }).r.select({ engine: 'claude-code' })).id).toBe('claude-code'); });
  it('a switched-off engine is refused when asked for, and skipped when chosen automatically', async () => {
    await expect(mk({ enabled: (id) => id !== 'codex' }).r.select({ engine: 'codex' })).rejects.toMatchObject({ code: 'provider_method_disabled' }); await expect(mk({ enabled: (id) => id !== 'codex', cfg: 'codex' }).r.select()).rejects.toMatchObject({ code: 'provider_method_disabled' });
    expect((await mk({ enabled: (id) => id !== 'claude-code' }).r.select()).id).toBe('codex');
  });
  it('nothing installed, or everything off, gives a provider error, and no probe runs for a disabled engine', async () => {
    await expect(mk({ installed: [] }).r.select()).rejects.toBeInstanceOf(ProviderError); const m = mk({ enabled: () => false }); await expect(m.r.select()).rejects.toMatchObject({ code: 'provider_method_disabled' }); expect(m.probes).toEqual([]);
    await expect(mk({ register: [] }).r.select()).rejects.toMatchObject({ code: 'provider_not_installed' });
  });
});

describe('capabilities', () => { it('requireCapability throws provider_capability_missing', () => { expect(() => requireCapability(new Set(['streaming']), 'resume')).toThrowError(expect.objectContaining({ code: 'provider_capability_missing' })); expect(() => requireCapability(new Set(['streaming']), 'streaming')).not.toThrow(); }); });
