/**
 * Accounts and sharing in the main process: who is signed in (shared by every window), the device sign-in, and, in the pieces
 * that follow, hosting a session over the relay and joining one. A person who never signs in never starts any of it: local sessions do not
 * need the server.
 */
import { Account, type AccountStatus } from '@centcom/tui';
import type { AccountView, ClientMsg, ServerMsg } from './protocol.js';

export interface CollabOptions {
  version: string;
  /** Tells every window something. */ broadcast(m: ServerMsg): void;
  /** Opens the sign-in page in the browser; false when it may not be opened or could not be. `apiBase` is the configured API address. */ openExternal(url: string, apiBase: string): boolean;
  /** A seam for tests: the account to use. */ makeAccount?: () => Promise<Account>;
}
export type CollabMsg = Extract<ClientMsg, { t: 'account' | 'login' | 'cancelLogin' | 'logout' }>;
export const isCollabMsg = (m: ClientMsg): m is CollabMsg => m.t === 'account' || m.t === 'login' || m.t === 'cancelLogin' || m.t === 'logout';
const view = (s: AccountStatus): AccountView => ({ signedIn: s.signedIn, persisted: s.persisted, api: s.api, ...(s.offline ? { offline: true } : {}), ...(s.me ? { me: s.me } : {}) });
const why = (e: unknown): string => {
  const name = (e as { name?: string })?.name ?? ''; const msg = e instanceof Error ? e.message : '';
  if (name === 'DeviceFlowDeniedError') return 'The sign-in was declined in the browser.';
  if (name === 'DeviceFlowExpiredError') return 'The code expired before it was approved. Start again.';
  if (name === 'TransportError' || /fetch failed|ECONNREFUSED|network/i.test(msg)) return 'Could not reach the Centcom server. Check your connection and the server address.';
  return msg && msg.length < 160 ? msg : 'Sign-in did not work. Try again.';
};

export class CollabService {
  private account?: Promise<Account>; private attempt?: { abort: AbortController; shown: Extract<ServerMsg, { t: 'login'; phase: 'code' }> };
  constructor(private readonly o: CollabOptions) {}
  /** The account, built on first use (reading the configuration and the keychain happens only for someone who asks). */
  getAccount(): Promise<Account> { this.account ??= (this.o.makeAccount ?? (() => Account.create({ app: 'centcom-desktop', version: this.o.version })))(); return this.account; }

  async handle(m: CollabMsg, send: (m: ServerMsg) => void): Promise<void> {
    switch (m.t) {
      case 'account': { try { send({ t: 'account', account: view(await (await this.getAccount()).status()) }); } catch { send({ t: 'account', account: { signedIn: false, persisted: false, api: '' } }); } return; }
      case 'login': {
        if (this.attempt) { send(this.attempt.shown); return; }
        const a = await this.getAccount(); const ac = new AbortController();
        try {
          const login = await a.beginLogin(); const opened = this.o.openExternal(login.verificationUriComplete, a.baseUrl);
          const shown = { t: 'login' as const, phase: 'code' as const, userCode: login.userCode, url: login.verificationUriComplete, expiresInS: login.expiresInS, opened };
          this.attempt = { abort: ac, shown }; this.o.broadcast(shown);
          try { const st = await login.wait(ac.signal); this.attempt = undefined; this.o.broadcast({ t: 'account', account: view(st) }); this.o.broadcast({ t: 'login', phase: 'done' }); }
          catch (e) { this.attempt = undefined; if (ac.signal.aborted) this.o.broadcast({ t: 'login', phase: 'cancelled' }); else this.o.broadcast({ t: 'login', phase: 'failed', error: why(e) }); }
        } catch (e) { this.attempt = undefined; send({ t: 'login', phase: 'failed', error: why(e) }); }
        return;
      }
      case 'cancelLogin': this.attempt?.abort.abort(); return;
      case 'logout': { const a = await this.getAccount(); await a.logout(); this.o.broadcast({ t: 'account', account: view(await a.status()) }); return; }
    }
  }
}
