/** Public surface of the auth client (lane C052). Other lanes import from here, never from the files behind it. */
export { startDeviceLogin, DEVICE_CODE_GRANT, SLOW_DOWN_STEP_S, MAX_POLL_NETWORK_FAILURES, type DeviceLogin, type DeviceLoginOptions } from './device-flow.js';
export { pkceStart, pkceComplete, s256Challenge, constantTimeEqual, DESKTOP_REDIRECT_URI, type PkceStart, type PkcePending } from './pkce.js';
export { createKeychainTokenStore, createKeychainApiKeyStore, memoryTokenStore, osAuthKeychain, AUTH_KEYCHAIN_SERVICE, API_KEY_RE, type StoredAuth, type TokenStore, type ApiKeyStore } from './keychain-store.js';
export { TokenManager, EARLY_REFRESH_MS, TERMINAL_REFRESH_CODES, type AuthEvent, type AuthEventPayload, type AuthStatus, type Principal, type TokenManagerOptions } from './token-manager.js';
export { acquireRefreshLock, withRefreshLock, RefreshLockTimeoutError, LOCK_STALE_MS, LOCK_ACQUIRE_TIMEOUT_MS, LOCK_HEARTBEAT_MS, LOCK_FILE, type LockHandle, type RefreshLockOptions } from './refresh-lock.js';
export { decodeAccessClaims, type AccessClaims } from './jwt-claims.js';
export { AuthRequiredError, DeviceFlowDeniedError, DeviceFlowExpiredError, KeychainUnavailableError, PkceCallbackError, KEYCHAIN_REMEDIATION } from './errors.js';
export { DEFAULT_CLI_SCOPES, tokenSetFrom, realAuthClock, type AuthClock, type TerminalClientId, type TokenSet } from './types.js';
/* DeviceKeyProvider: the auth client only needs getOrCreatePublicKeys, and C056's DeviceKeyProvider (exported by the crypto module) already has it. */
export type { DeviceKeyProvider as AuthDeviceKeyProvider } from './types.js';
