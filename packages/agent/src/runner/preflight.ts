/** The runner's check before it spawns anything: is the tool there, and is it a version Centcom has been checked against? Built on the provider detector, so the daemon says the same thing as `centcom doctor`. */
import { ProviderError, type EngineId } from '../types.js';
import type { DetectedEngine, ProviderDetector } from '../provider/detect/detect.js';

/** `unsupportedOk` mirrors config `agent.engine_unsupported_ok`. Sign-in is not checked here: the engine reports it with the first turn, with the tool's own words. */
export function preflightFromDetector(detector: ProviderDetector, o: { unsupportedOk?: boolean } = {}): (id: EngineId) => Promise<void> {
  return async (id) => {
    if (id !== 'claude-code' && id !== 'codex') return; // other engines (the demo and test engines) have nothing to find
    const s = await detector.detect(id as DetectedEngine);
    if (!s.installed) throw new ProviderError('provider_not_installed', id, `${id} is not installed.`);
    if ((s.supported === 'below' || s.supported === 'above') && !o.unsupportedOk) throw new ProviderError('provider_version_unsupported', id, `${id} ${s.version ?? ''} is outside ${s.supported_range}.`.replace('  ', ' '));
  };
}
