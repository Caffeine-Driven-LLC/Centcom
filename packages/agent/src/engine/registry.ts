import { ProviderError, type AgentEngine, type EngineId } from '../types.js';

export interface RegistryDeps { isEngineEnabled(id: EngineId): boolean; config: { get(k: 'agent.engine'): EngineId | undefined }; probe(id: EngineId): Promise<{ installed: boolean }> }
export interface SelectingEngineRegistry { register(e: AgentEngine): void; get(id: EngineId): AgentEngine; list(): AgentEngine[]; select(o?: { engine?: EngineId }): Promise<AgentEngine> }
const PREFERENCE: readonly EngineId[] = ['claude-code', 'codex'];

/** Choosing an engine: explicit option, then config `agent.engine`, then the first installed of claude-code, codex. A switched-off engine is refused. */
export function createEngineRegistry(d: RegistryDeps): SelectingEngineRegistry {
  const engines = new Map<EngineId, AgentEngine>();
  const get = (id: EngineId) => { const e = engines.get(id); if (!e) throw new ProviderError('provider_not_installed', id, `No engine registered for ${id}.`); return e; };
  const usable = (id: EngineId) => { if (!d.isEngineEnabled(id)) throw new ProviderError('provider_method_disabled', id, 'This way of using the provider is turned off.'); return get(id); };
  return {
    register: (e) => { engines.set(e.id, e); }, get, list: () => [...engines.values()],
    async select(o = {}) {
      const wanted = o.engine ?? d.config.get('agent.engine'); if (wanted) return usable(wanted);
      let disabled: EngineId | undefined;
      for (const id of PREFERENCE) { if (!engines.has(id)) continue; if (!d.isEngineEnabled(id)) { disabled ??= id; continue; } if ((await d.probe(id)).installed) return get(id); }
      if (disabled) throw new ProviderError('provider_method_disabled', disabled, 'This way of using the provider is turned off.');
      throw new ProviderError('provider_not_installed', 'claude-code', 'Neither Claude Code nor Codex was found.');
    },
  };
}
