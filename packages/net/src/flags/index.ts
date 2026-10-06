/** Public surface of the feature flags client (lane C067). Other lanes import from here, never from the files behind it. */
export { FlagsClient, FAILURE_RETRY_MS, MAX_TTL_S, MIN_TTL_S, REFRESH_TIMEOUT_MS, clampTtlS, type FlagsAuthEvents, type FlagsChange, type FlagsClientOptions, type FlagsSnapshot } from './client.js';
export { FLAG_DEFS, FLAG_KEY_RE, defineFlag, typed, type FlagDef, type FlagDefs, type FlagRegistry, type FlagType, type FlagValue } from './registry.js';
export { FLAGS_CACHE_MAX_AGE_MS, FLAGS_CACHE_VERSION, FlagsDiskCache, cleanFlags, type FlagsCacheEntry } from './cache.js';
export { FLAGS_CONFIG_KEY, FLAGS_ENV, coerce, overridesAllowed, parseOverrides, resolveOverrides } from './overrides.js';
