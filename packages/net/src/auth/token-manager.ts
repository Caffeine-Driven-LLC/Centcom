/** Hands every other lane a valid access token: in memory only, refreshed early (< 60 s left) or on `token_expired`, once at a time in this process (single flight) and across processes (file lock).
 *  The rotated refresh token is written to the store before the new access token is used; a terminal refresh error clears the sign-in.
 *  Must not: do I/O in the constructor; persist an access token; send one refresh token twice; trust claims for authorisation; log or throw a token or key. */
import type { AuthProvider, HttpClient } from '../http/index.js';
import { ApiError } from '../http/index.js';
import type { Logger } from '../log/index.js';
import { AuthRequiredError, KeychainUnavailableError } from './errors.js';
import { decodeAccessClaims, type AccessClaims } from './jwt-claims.js';
import { API_KEY_RE, type ApiKeyStore, type StoredAuth, type TokenStore } from './keychain-store.js';
import { withRefreshLock, type RefreshLockOptions } from './refresh-lock.js';
import { tokenSetFrom, type AuthClock, type TerminalClientId, type TokenSet } from './types.js';

/** Refresh when the access token has less than this left. */
export const EARLY_REFRESH_MS = 60_000;
/** Refresh answers that end the sign-in: the store is cleared and the person must log in again. */
export const TERMINAL_REFRESH_CODES: ReadonlySet<string> = new Set(['refresh_reuse_detected', 'token_revoked', 'token_invalid', 'device_revoked', 'invalid_grant']);

export type AuthEvent = 'auth-required' | 'refreshed' | 'ent-changed';
export interface AuthEventPayload { 'auth-required': { reason?: string }; refreshed: { expiresAt: number }; 'ent-changed': { previous: number; current: number } }
export type Principal = 'device' | 'api_key';
export interface AuthStatus {
  signedIn: boolean; principal: Principal | null;
  /** false when the sign-in lives only in this process (keychain unavailable) */
  persisted: boolean;
  keychain: 'ok' | 'unavailable';
  deviceId?: string;
}

export interface TokenManagerOptions {
  /** used for the token endpoint (public) and, with this manager as its identity, for revoke */
  http: HttpClient; store: TokenStore; clock: AuthClock;
  /** directory of the cross-process refresh lock (created 0700 on first refresh) */
  lockDir: string;
  /** optional machine principal; an API key, when stored, is used instead of a device sign-in */
  apiKeys?: ApiKeyStore;
  clientId?: TerminalClientId;
  /** the API host the sign-in belongs to (used by adopt when none is passed) */
  apiHost?: string;
  logger?: Logger;
  lock?: RefreshLockOptions;
}

export class TokenManager {
  private readonly o: TokenManagerOptions; private readonly log?: Logger;
  private access: { token: string; expiresAt: number; claims: AccessClaims | null } | null = null;
  /** the sign-in, when the keychain could not take it: this process only */
  private volatile: StoredAuth | null = null; private volatileKey: string | null = null;
  private inflight: Promise<string> | null = null; private keychainDown = false; private requiredEmitted = false;
  private lastEnt: number | undefined;
  private readonly listeners: { [K in AuthEvent]: Set<(p: AuthEventPayload[K]) => void> } = { 'auth-required': new Set(), refreshed: new Set(), 'ent-changed': new Set() };

  /** No I/O here: a missing sign-in only shows up on code paths that need the backend. */
  constructor(o: TokenManagerOptions) { this.o = o; this.log = o.logger?.child({ component: 'auth' }); }

  /** A valid bearer: an API key when one is stored, else the device access token, refreshed when it has < 60 s left. Throws AuthRequiredError when there is no sign-in. */
  async getAccessToken(): Promise<string> {
    const key = await this.loadApiKey(); if (key) return key;
    const a = this.access; if (a && a.expiresAt - this.o.clock.now() >= EARLY_REFRESH_MS) return a.token;
    return this.refreshOnce();
  }

  /** Refresh now, whatever the expiry (after a 401 token_expired). Shares a refresh already in flight. */
  async forceRefresh(): Promise<void> { if (await this.loadApiKey()) return; this.access = null; await this.refreshOnce(); }

  /** Claims of the current access token (decoded, not verified), or null. For scheduling and cache invalidation only. */
  claims(): AccessClaims | null { return this.access?.claims ?? null; }

  /** This manager as the HTTP client's identity (C051 AuthProvider). */
  authProvider(): AuthProvider {
    return {
      getAccessToken: async () => { try { return await this.getAccessToken(); } catch { return undefined; } },
      onUnauthorized: async () => { try { await this.forceRefresh(); return true; } catch { return false; } },
    };
  }

  /** Take the tokens of a finished login. The refresh token is saved before the access token is used; when the keychain is unavailable the sign-in is kept for this process only (`persisted: false`). A stored API key is removed. */
  async adopt(t: TokenSet, apiHost = this.o.apiHost): Promise<{ persisted: boolean }> {
    if (!apiHost) throw new TypeError('adopt needs the API host (pass it or set apiHost on the TokenManager)');
    const persisted = await this.saveAuth({ refreshToken: t.refreshToken, deviceId: t.deviceId, apiHost });
    if (this.o.apiKeys) { try { await this.o.apiKeys.clear(); } catch { /* nothing stored, or keychain down */ } }
    this.volatileKey = null; this.requiredEmitted = false; this.setAccess(t);
    this.log?.info('auth.signed_in', { principal: 'device', persisted, device: t.deviceId });
    return { persisted };
  }

  /** Use an API key (`cen_live_` / `cen_test_`) as the principal. Checked locally first; kept only in the keychain (or this process when it is unavailable). */
  async useApiKey(key: string): Promise<{ persisted: boolean }> {
    if (!API_KEY_RE.test(key)) throw new TypeError('not a Centcom API key');
    if (!this.o.apiKeys) throw new TypeError('this TokenManager has no API key store');
    let persisted = true;
    try { await this.o.apiKeys.save(key); this.keychainDown = false; } catch (e) { if (!(e instanceof KeychainUnavailableError)) throw e; this.keychainDown = true; persisted = false; }
    this.volatileKey = persisted ? null : key; this.requiredEmitted = false;
    this.log?.info('auth.signed_in', { principal: 'api_key', persisted });
    return { persisted };
  }

  /** What is signed in, without any network call. */
  async status(): Promise<AuthStatus> {
    const key = await this.loadApiKey(); const stored = await this.loadAuth();
    const persisted = key ? !this.volatileKey : !this.volatile;
    if (key) return { signedIn: true, principal: 'api_key', persisted, keychain: this.keychainDown ? 'unavailable' : 'ok' };
    return { signedIn: !!stored, principal: stored ? 'device' : null, persisted: stored ? persisted : true, keychain: this.keychainDown ? 'unavailable' : 'ok', ...(stored ? { deviceId: stored.deviceId } : {}) };
  }

  /** Revoke the refresh token on the server (POST /v1/auth/revoke), then clear keychain and memory. Offline, or when the server refuses, local state is still cleared and `serverRevoked` is false. */
  async logout(_o: { allDevices?: false } = {}): Promise<{ serverRevoked: boolean; principal: Principal | null }> {
    const key = await this.loadApiKey(); const had = await this.loadAuth(); let serverRevoked = false;
    try {
      if (had && !key) {
        const bearer = await this.getAccessToken(); /* may rotate the refresh token: revoke the newest one */
        const now = (await this.loadAuth()) ?? had;
        await this.o.http.withAuthProvider({ getAccessToken: async () => bearer }).call('revokeToken', { body: { token: now.refreshToken, token_type_hint: 'refresh_token' } });
        serverRevoked = true;
      }
    } catch (e) { this.log?.info('auth.logout.server_skipped', { error: errName(e) }); }
    await this.clearLocal();
    this.log?.info('auth.signed_out', { server_revoked: serverRevoked });
    return { serverRevoked, principal: key ? 'api_key' : had ? 'device' : null };
  }

  /** Forget the sign-in on this computer (keychain and memory), without asking the server. Throws KeychainUnavailableError when the keychain could not be cleared (memory is cleared anyway). */
  async clearLocal(): Promise<void> {
    this.access = null; this.volatile = null; this.volatileKey = null; let err: unknown;
    try { await this.o.store.clear(); } catch (e) { err = e; }
    if (this.o.apiKeys) { try { await this.o.apiKeys.clear(); } catch (e) { err ??= e; } }
    if (err) throw err;
  }

  /** Listen for `auth-required` (the sign-in ended), `refreshed`, `ent-changed` (consumed by C064). Returns the unsubscribe. */
  on<K extends AuthEvent>(ev: K, fn: (p: AuthEventPayload[K]) => void): () => void { const s = this.listeners[ev] as Set<(p: AuthEventPayload[K]) => void>; s.add(fn); return () => { s.delete(fn); }; }

  /* ------------------------------------------------------------ internals */

  private emit<K extends AuthEvent>(ev: K, p: AuthEventPayload[K]): void { for (const fn of [...this.listeners[ev]] as ((p: AuthEventPayload[K]) => void)[]) { try { fn(p); } catch { /* a listener must not break auth */ } } }

  private setAccess(t: TokenSet): void {
    const claims = decodeAccessClaims(t.accessToken); const now = this.o.clock.now();
    const expiresAt = claims ? Math.min(claims.exp * 1000, now + t.expiresInS * 1000) : now + t.expiresInS * 1000;
    this.access = { token: t.accessToken, expiresAt, claims };
    if (claims?.ent !== undefined) { const prev = this.lastEnt; this.lastEnt = claims.ent; if (prev !== undefined && prev !== claims.ent) this.emit('ent-changed', { previous: prev, current: claims.ent }); }
  }

  private async loadApiKey(): Promise<string | null> {
    if (this.volatileKey) return this.volatileKey; if (!this.o.apiKeys) return null;
    try { const k = await this.o.apiKeys.load(); this.keychainDown = false; return k; } catch (e) { if (e instanceof KeychainUnavailableError) { this.keychainDown = true; return null; } throw e; }
  }

  private async loadAuth(): Promise<StoredAuth | null> {
    if (this.volatile) return this.volatile;
    try { const a = await this.o.store.load(); this.keychainDown = false; return a; } catch (e) { if (e instanceof KeychainUnavailableError) { this.keychainDown = true; return null; } throw e; }
  }

  /** Keychain first; when it is unavailable, this process only. Never a file. */
  private async saveAuth(a: StoredAuth): Promise<boolean> {
    try { await this.o.store.save(a); this.volatile = null; this.keychainDown = false; return true; } catch (e) {
      if (!(e instanceof KeychainUnavailableError)) throw e;
      this.volatile = a; this.keychainDown = true; this.log?.warn('auth.keychain_unavailable', {}); return false;
    }
  }

  private refreshOnce(): Promise<string> {
    if (!this.inflight) this.inflight = this.refreshLocked().finally(() => { this.inflight = null; });
    return this.inflight;
  }

  /** Under the cross-process lock: re-read the store (another process may have rotated it), send that token once, save the rotated one, then hand out the access token. */
  private async refreshLocked(): Promise<string> {
    const run = async (): Promise<string> => {
      const stored = await this.loadAuth();
      if (!stored) throw this.authRequired(undefined, false);
      let t: TokenSet;
      try {
        const r = await this.o.http.call('issueToken', { body: { grant_type: 'refresh_token', refresh_token: stored.refreshToken, client_id: this.o.clientId ?? 'centcom-cli' } });
        t = tokenSetFrom(r.data);
      } catch (e) {
        if (e instanceof ApiError && TERMINAL_REFRESH_CODES.has(e.rawCode)) {
          this.log?.warn('auth.refresh.ended', { code: e.rawCode, request_id: e.requestId });
          this.access = null; this.volatile = null;
          try { await this.o.store.clear(); } catch { /* the token is dead either way */ }
          throw this.authRequired(e.rawCode, true);
        }
        this.log?.info('auth.refresh.failed', { error: errName(e) }); /* the stored token is kept: the next call tries again */
        throw e;
      }
      /* the rotated token must be stored before the new access token is used; if the keychain fails it is kept in memory, never dropped */
      const persisted = await this.saveAuth({ refreshToken: t.refreshToken, deviceId: t.deviceId || stored.deviceId, apiHost: stored.apiHost });
      this.setAccess(t); this.requiredEmitted = false;
      this.log?.info('auth.refreshed', { persisted });
      return t.accessToken;
    };
    if (!(await this.loadAuth())) throw this.authRequired(undefined, false); /* nothing to refresh: no lock, no request */
    const token = this.volatile ? await run() : await withRefreshLock(this.o.lockDir, run, this.o.lock);
    this.emit('refreshed', { expiresAt: this.access?.expiresAt ?? 0 });
    return token;
  }

  private authRequired(reason: string | undefined, emit: boolean): AuthRequiredError {
    if (emit && !this.requiredEmitted) { this.requiredEmitted = true; this.emit('auth-required', reason ? { reason } : {}); }
    return new AuthRequiredError(reason);
  }
}

const errName = (e: unknown): string => (e instanceof ApiError ? e.rawCode : e instanceof Error ? e.name : 'unknown');
