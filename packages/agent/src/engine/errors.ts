export { ProviderError } from '../types.js';
export type { ProviderErrorCode } from '../types.js';
export const PROVIDER_ERROR_CODES = ['provider_not_installed', 'provider_not_signed_in', 'provider_method_disabled', 'provider_policy_blocked', 'provider_cap_reached', 'provider_rate_limited', 'provider_version_unsupported', 'provider_protocol_error', 'provider_capability_missing'] as const;
