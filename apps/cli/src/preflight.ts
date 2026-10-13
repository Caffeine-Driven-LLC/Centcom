/** Looked at once when the app starts, without holding anything up: is the agent's own tool signed in, and is its version one Centcom has been checked against? A problem becomes a notice now, not an error on the first message (lane C104). */
import { providerMessage, type DetectedEngine, type ProviderDetector, type ProviderStatus } from '@centcom/agent';

export interface PreflightIO { detector: Pick<ProviderDetector, 'detect'>; notice(level: 'warn' | 'info', text: string, detail?: string): void }

/** What was said, so a test (and `centcom doctor`) can see it; nothing is said when everything is fine or the tool could not be asked. */
export async function providerPreflight(engine: DetectedEngine, io: PreflightIO): Promise<{ said: string[]; status?: ProviderStatus }> {
  const said: string[] = []; let status: ProviderStatus;
  try { status = await io.detector.detect(engine); } catch { return { said }; } // never in the way: an unreadable answer is no news
  if (!status.installed) return { said, status };
  const say = (code: 'provider_not_signed_in' | 'provider_version_unsupported', extra = '') => { const m = providerMessage(code, { engine }); said.push(code); io.notice('warn', m.title, `${m.body}${extra}\n${m.next_step}`); };
  if (status.errors.includes('provider_version_unsupported')) say('provider_version_unsupported', status.version ? `\nIt is version ${status.version}; Centcom has been checked with ${status.supported_range}.` : '');
  if (status.signed_in === 'no') say('provider_not_signed_in');
  return { said, status };
}
