import { ProviderError, type Capability, type EngineId } from '../types.js';
export type CapabilitySet = ReadonlySet<Capability>;
export const ALL_CAPABILITIES: readonly Capability[] = ['streaming', 'approvals', 'resume', 'subagents', 'mcp', 'skills', 'thinking', 'usage', 'models.list', 'interrupt', 'compact'];
/** UI and session code ask for a capability; they never look at the engine id. */
export function requireCapability(set: CapabilitySet, cap: Capability, engine: EngineId = 'fake'): void {
  if (!set.has(cap)) throw new ProviderError('provider_capability_missing', engine, `The engine does not support ${cap}.`);
}
