/**
 * The signed-in person, for the apps that run agents on this computer (the terminal app and the desktop app): who is signed in,
 * the device-code sign-in, sign-out, and the authenticated clients that sharing needs (REST and the session client).
 * It is the same wiring as `centcom login` (config, OS keychain, token manager), so one sign-in serves every app on this computer.
 * Nothing here is needed to work locally: a person who never signs in never touches it.
 * Must not: print or return a token; start a network call before a method is called.
 */
import { hostname } from 'node:os';
import { join } from 'node:path';
import { defaultDeps, loadConfig, stateDir } from '@centcom/config';
import { CryptoError, DeviceKeyStore, TokenManager, TrustStore, createHttpClient, createKeychainApiKeyStore, createKeychainTokenStore, createSessionClient, defaultUserAgent, fileKeychain, initCrypto, keychainDirFromEnv, memoryKeychain, osAuthKeychain, osKeychain, realAuthClock, startDeviceLogin } from '@centcom/net';
import { JoinedSession } from './joined.js';
import { parseJoinTarget } from './target.js';
import type { AuthClock, HttpClient, Keychain, Logger, SessionClient } from '@centcom/net';

export interface AccountMe { id: string; name: string; email: string; plan: string; workspace?: { id: string; name: string | null } }
export interface AccountStatus { signedIn: boolean; /** false: the sign-in lives in this process only (no OS keychain) */ persisted: boolean; me?: AccountMe; /** signed in but the server could not be asked */ offline?: boolean; api: string }
export interface LoginAttempt { userCode: string; verificationUri: string; verificationUriComplete: string; expiresInS: number; /** Waits for the person to approve in the browser. Rejects when denied, expired or aborted. */ wait(signal?: AbortSignal): Promise<AccountStatus> }
export interface AccountOptions {
  /** what to call this app in the server's device list and in the user agent */
  app: 'centcom-cli' | 'centcom-tui' | 'centcom-desktop'; version: string; logger?: Logger;
  /** default: api.base_url of the config (CENTCOM_API_URL) */ baseUrl?: string;
  /** default: the relay the server names (CENTCOM_RELAY_URL overrides) */ relayUrl?: string;
  /** `memory`: nothing is stored (tests, throwaway machines); also CENTCOM_KEYCHAIN=memory */ keychain?: 'os' | 'memory';
  fetch?: typeof fetch; stateDir?: string; deviceName?: string; /** the sign-in's timers (tests make them instant) */ clock?: AuthClock;
}

/** Device keys go to the OS keychain; if it is unavailable they stay in memory for this run (like the sign-in itself). */
function keysKeychain(primary: Keychain): Keychain {
  const mem = memoryKeychain(); let down = false;
  const run = async <T>(f: (k: Keychain) => Promise<T>): Promise<T> => { if (down) return f(mem); try { return await f(primary); } catch (e) { if (!(e instanceof CryptoError)) throw e; down = true; return f(mem); } };
  return { get: (a) => run((k) => k.get(a)), set: (a, v) => run((k) => k.set(a, v)), delete: (a) => run((k) => k.delete(a)) };
}
const isLoopback = (u: string): boolean => { try { const h = new URL(u).hostname; return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1'; } catch { return false; } };

export class Account {
  /** the authenticated REST client */ readonly http: HttpClient; readonly baseUrl: string;
  private keys?: DeviceKeyStore; private sessionClient?: SessionClient;
  private constructor(private readonly o: AccountOptions, private readonly auth: TokenManager, private readonly keyKc: Keychain, readonly plain: HttpClient, baseUrl: string) { this.http = plain.withAuthProvider(auth.authProvider()); this.baseUrl = baseUrl; }

  static async create(o: AccountOptions): Promise<Account> {
    const d = defaultDeps(); const cfg = await loadConfig(d); const baseUrl = o.baseUrl ?? cfg.api.base_url; const apiHost = new URL(baseUrl).host; const dir = o.stateDir ?? stateDir(d);
    const memory = (o.keychain ?? (process.env.CENTCOM_KEYCHAIN === 'memory' ? 'memory' : 'os')) === 'memory';
    const kcDir = keychainDirFromEnv(); const authKc = memory ? memoryKeychain() : kcDir ? fileKeychain(kcDir) : osAuthKeychain(); const keyKc = memory ? memoryKeychain() : kcDir ? fileKeychain(kcDir) : keysKeychain(osKeychain());
    const plain = createHttpClient({ getAccessToken: async () => undefined, baseUrl, userAgent: defaultUserAgent(o.version), logger: o.logger, timeoutMs: cfg.net.timeout_ms, maxAttempts: cfg.net.max_attempts, ...(o.fetch ? { fetch: o.fetch } : {}) });
    const auth = new TokenManager({ http: plain, store: createKeychainTokenStore(apiHost, { keychain: authKc }), apiKeys: createKeychainApiKeyStore(apiHost, { keychain: authKc }), clock: o.clock ?? realAuthClock, lockDir: join(dir, 'locks'), apiHost, logger: o.logger });
    return new Account(o, auth, keyKc, plain, baseUrl);
  }

  private async keyStore(id: string): Promise<DeviceKeyStore> { await initCrypto(); this.keys ??= new DeviceKeyStore(this.keyKc, id); return this.keys; }

  async status(): Promise<AccountStatus> {
    const st = await this.auth.status().catch(() => ({ signedIn: false, persisted: false }) as { signedIn: boolean; persisted: boolean });
    if (!st.signedIn) return { signedIn: false, persisted: st.persisted, api: this.baseUrl };
    try { await this.auth.getAccessToken(); const me = await this.me(); return { signedIn: true, persisted: st.persisted, me, api: this.baseUrl }; }
    catch (e) { const gone = (e as { name?: string }).name === 'AuthRequiredError' || (e as { name?: string }).name === 'AuthExpiredError'; return gone ? { signedIn: false, persisted: st.persisted, api: this.baseUrl } : { signedIn: true, persisted: st.persisted, offline: true, api: this.baseUrl }; }
  }

  async me(): Promise<AccountMe> {
    const me = (await this.http.call('getMe', {})).data; let workspace: AccountMe['workspace'];
    if (me.active_workspace) { const name = await this.http.call('getWorkspace', { path: { id: me.active_workspace } }).then((r) => r.data.name, () => null); workspace = { id: me.active_workspace, name }; }
    return { id: me.user.id, name: me.user.display_name, email: me.user.email, plan: me.plan, ...(workspace ? { workspace } : {}) };
  }

  /** Starts the device sign-in: show `userCode` and open `verificationUriComplete`, then `wait()`. */
  async beginLogin(): Promise<LoginAttempt> {
    await initCrypto(); const keys = { getOrCreatePublicKeys: async () => (await this.keyStore('pending')).getOrCreatePublicKeys() };
    const login = await startDeviceLogin({ http: this.plain, deviceName: this.o.deviceName ?? (hostname() || 'Centcom device'), keys, clock: this.o.clock ?? realAuthClock, logger: this.o.logger });
    return {
      userCode: login.userCode, verificationUri: login.verificationUri, verificationUriComplete: login.verificationUriComplete, expiresInS: login.expiresInS,
      wait: async (signal) => { const tokens = await login.poll(signal); await this.auth.adopt(tokens); try { await this.keys?.rebindDeviceId(tokens.deviceId); } catch { /* retried on next use */ } this.sessionClient = undefined; return this.status(); },
    };
  }

  async logout(): Promise<void> { this.sessionClient = undefined; await this.auth.logout().catch(async () => { await this.auth.clearLocal().catch(() => undefined); }); }

  /** The session client for this device (hosting and joining). Needs a device sign-in, not an API key. */
  async sessions(): Promise<SessionClient> {
    if (this.sessionClient) return this.sessionClient;
    const st = await this.auth.status(); if (!st.signedIn || !st.deviceId) throw Object.assign(new Error('Sign in to share a session.'), { code: 'not_signed_in' });
    const keys = await this.keyStore(st.deviceId); await keys.getOrCreatePublicKeys();
    const relayUrl = this.o.relayUrl ?? process.env.CENTCOM_RELAY_URL;
    this.sessionClient = createSessionClient({ http: this.http, crypto: { device: keys, trust: new TrustStore(), keychain: this.keyKc }, deviceId: st.deviceId, clientInfo: { name: this.o.app, version: this.o.version, contract: '1.0' } as never, ...(relayUrl ? { relayUrl } : {}), allowPlainWs: isLoopback(this.baseUrl), ...(this.o.logger ? { logger: this.o.logger } : {}) });
    return this.sessionClient;
  }

  /** Invites one person into one session only (no workspace seat): the host's call. Returns the link to send. */
  async inviteToSession(sessionId: string, o: { email?: string; role?: 'editor' | 'viewer'; expiresInS?: number } = {}): Promise<{ url: string; token: string; email?: string }> {
    const r = (await this.http.call('createSessionInvite', { path: { id: sessionId }, body: { role: o.role ?? 'editor', ...(o.email ? { email: o.email } : {}), ...(o.expiresInS ? { expires_in_s: o.expiresInS } : {}) } } as never)).data as unknown as { token: string; url: string };
    return { token: r.token, url: r.url, ...(o.email ? { email: o.email } : {}) };
  }
  /** Accepts an invite (a session invite, or a workspace one): the session to join, when it names one. */
  async acceptInvite(token: string): Promise<{ session?: string; role?: string; workspace?: string }> {
    const r = (await this.http.call('acceptInvite', { path: { token } } as never)).data as unknown as { session?: string | { id?: string }; role?: string; workspace?: string | { id?: string } };
    const id = (v: unknown): string | undefined => (typeof v === 'string' ? v : (v as { id?: string } | undefined)?.id);
    return { ...(id(r.session) ? { session: id(r.session)! } : {}), ...(r.role ? { role: r.role } : {}), ...(id(r.workspace) ? { workspace: id(r.workspace)! } : {}) };
  }

  /**
   * Joins a session from what the person pasted: an invite link or token (accepted first), a session id, or a watch-only link (no
   * account needed for that one, which is why it does not use this account's sign-in).
   */
  async join(input: string, o: { displayName?: string } = {}): Promise<{ joined: JoinedSession; how: 'invite' | 'session' | 'watch' }> {
    const target = parseJoinTarget(input); if (!target) throw Object.assign(new Error('That does not look like a session id or an invite link.'), { code: 'bad_target' });
    if (target.kind === 'watch') { // no account needed: the link is the credential, the keys of this visit live in memory only
      await initCrypto(); const keys = new DeviceKeyStore(memoryKeychain(), `dev_watch${Date.now().toString(36).toUpperCase()}`.slice(0, 30)); const relayUrl = this.o.relayUrl ?? process.env.CENTCOM_RELAY_URL;
      const client = createSessionClient({ http: this.plain, crypto: { device: keys, trust: new TrustStore() }, deviceId: 'watch', clientInfo: { name: this.o.app, version: this.o.version, contract: '1.0' } as never, ...(relayUrl ? { relayUrl } : {}), allowPlainWs: isLoopback(this.baseUrl), ...(this.o.logger ? { logger: this.o.logger } : {}) });
      return { joined: new JoinedSession(await client.joinViaShareLink({ token: target.token, displayName: (o.displayName ?? 'Guest').slice(0, 40), fragment: target.fragment })), how: 'watch' };
    }
    const sessions = await this.sessions(); let sessionId = target.kind === 'session' ? target.id : '';
    if (target.kind === 'invite') { const r = await this.acceptInvite(target.token); if (!r.session) throw Object.assign(new Error('That invite is not for a session. Ask for a session link.'), { code: 'bad_target' }); sessionId = r.session; }
    return { joined: new JoinedSession(await sessions.joinSession({ sessionId })), how: target.kind };
  }

  /** The workspaces this person is in (a session is created in one). */
  async workspaces(): Promise<{ id: string; name: string }[]> { const r = (await this.http.call('listWorkspaces', {})).data as unknown as { data?: { id: string; name: string }[] }; return (r.data ?? []).map((w) => ({ id: w.id, name: w.name })); }
}
