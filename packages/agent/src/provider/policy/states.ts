import type { NormalisedEvent, ProviderErrorCode } from '../../types.js';

export type ProviderState = 'provider-auth-required' | 'provider-cap-reached' | 'provider-policy-blocked';
/** Client-local states for the mascot and status line (C046). They are never sent in `agent.state`. `provider_rate_limited` uses the contract state `rate-limited` through C014. */
export function providerStateFor(x: ProviderErrorCode | Pick<NormalisedEvent, 'type'> & { code?: string }): ProviderState | undefined {
  const code = typeof x === 'string' ? x : (x as { type: string; code?: string }).type === 'error' ? (x as { code?: string }).code : undefined;
  switch (code) { case 'provider_not_signed_in': return 'provider-auth-required'; case 'provider_cap_reached': return 'provider-cap-reached'; case 'provider_policy_blocked': case 'provider_method_disabled': return 'provider-policy-blocked'; default: return undefined; }
}
