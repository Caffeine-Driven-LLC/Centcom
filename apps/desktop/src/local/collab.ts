/**
 * Accounts and sharing in the main process: who is signed in (shared by every window), the device sign-in, and, in the pieces
 * that follow, hosting a session over the relay and joining one. A person who never signs in never starts any of it: local sessions do not
 * need the server.
 */
import { Account, HostBridge, type AccountStatus } from '@centcom/tui';
import type { SessionHandle } from '@centcom/net';
import type { Workspace } from './workspace.js';
import type { AccountView, ClientMsg, ServerMsg, SharingView } from './protocol.js';

export interface CollabOptions {
  version: string;
  /** Tells every window something. */ broadcast(m: ServerMsg): void;
  /** Opens the sign-in page in the browser; false when it may not be opened or could not be. `apiBase` is the configured API address. */ openExternal(url: string, apiBase: string): boolean;
  /** A seam for tests: the account to use. */ makeAccount?: () => Promise<Account>;
  /** Tells the windows that show `ws`. */ toViewers?(ws: Workspace, m: ServerMsg): void;
}
export type CollabMsg = Extract<ClientMsg, { t: 'account' | 'login' | 'cancelLogin' | 'logout' }>;
export type ShareMsg = Extract<ClientMsg, { t: 'share' | 'unshare' | 'shareLink' | 'shareInvite' | 'shareDecide' | 'shareAuto' }>;
const ACCOUNT = new Set(['account', 'login', 'cancelLogin', 'logout']); const SHARE = new Set(['share', 'unshare', 'shareLink', 'shareInvite', 'shareDecide', 'shareAuto']);
export const isCollabMsg = (m: ClientMsg): m is CollabMsg => ACCOUNT.has(m.t);
export const isShareMsg = (m: ClientMsg): m is ShareMsg => SHARE.has(m.t);
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

  /* ---------------------------------------------------------------- sharing a conversation */
  private shares = new Map<Workspace, { name: string; handle?: SessionHandle; bridge?: HostBridge; state: SharingView['state']; error?: string; code?: string; link?: SharingView['link']; invite?: SharingView['invite']; hint?: string; workspace?: string; account?: Account }>();
  /** What the screens show for a conversation: undefined when it is not shared. */
  sharingOf(ws: Workspace): SharingView | null {
    const sh = this.shares.get(ws); if (!sh) return null; const h = sh.handle; const me = h?.me.id;
    return { state: sh.state, name: sh.name, ...(h ? { sessionId: h.id } : {}), ...(sh.workspace ? { workspace: sh.workspace } : {}), ...(sh.error ? { error: sh.error } : {}), ...(sh.code ? { code: sh.code } : {}), ...(sh.link ? { link: sh.link } : {}), ...(sh.invite ? { invite: sh.invite } : {}), ...(sh.hint ? { hint: sh.hint } : {}),
      auto: sh.bridge?.autoApproving ?? false,
      members: (h?.roster() ?? []).map((m) => ({ id: m.id, name: m.name || 'Someone', slot: m.slot, role: m.role, online: m.online !== false, you: m.id === me })),
      pending: (sh.bridge?.pending() ?? []).map((p) => ({ item: p.item, from: p.from, slot: p.slot, text: p.text.slice(0, 2000) })) };
  }
  private publish(ws: Workspace): void { this.o.toViewers?.(ws, { t: 'sharing', sharing: this.sharingOf(ws) }); }
  /** A window that starts showing `ws` is told whether it is shared. */
  sendSharing(ws: Workspace, send: (m: ServerMsg) => void): void { const v = this.sharingOf(ws); if (v) send({ t: 'sharing', sharing: v }); }
  stopSharing(ws: Workspace): void { const sh = this.shares.get(ws); if (!sh) return; sh.bridge?.stop(); void sh.handle?.leave().catch(() => undefined); this.shares.delete(ws); }

  async handleShare(m: ShareMsg, ws: Workspace | undefined, send: (m: ServerMsg) => void): Promise<void> {
    if (!ws || ws.demo) { send({ t: 'notice', level: 'info', text: ws?.demo ? 'The demo agent cannot be shared.' : 'Open a project first.' }); return; }
    const cur = this.shares.get(ws);
    switch (m.t) {
      case 'share': {
        if (cur && cur.state !== 'ended' && cur.state !== 'failed') { this.publish(ws); return; }
        const name = ws.dir.replace(/\/+$/, '').split('/').pop() || 'session'; const sh: NonNullable<typeof cur> = { name, state: 'starting' }; this.shares.set(ws, sh); this.publish(ws);
        try {
          const account = await this.getAccount(); sh.account = account; const st = await account.status();
          if (!st.signedIn) { sh.state = 'failed'; sh.code = 'not_signed_in'; sh.error = 'Sign in first: sharing needs an account.'; this.publish(ws); return; }
          const sessions = await account.sessions(); const spaces = await account.workspaces(); const home = st.me?.workspace?.id ?? spaces[0]?.id;
          if (!home) { sh.state = 'failed'; sh.error = 'Your account has no workspace to share in.'; this.publish(ws); return; }
          sh.workspace = spaces.find((w) => w.id === home)?.name ?? home;
          const handle = await sessions.createSession({ name, workspace: home }); sh.handle = handle;
          const bridge = new HostBridge(ws.ctl, handle, { onChange: () => this.publish(ws), onError: () => undefined }); sh.bridge = bridge; bridge.start(); sh.state = 'live';
          handle.on('state', (s) => { if (s === 'ended') sh.state = 'ended'; this.publish(ws); }); handle.on('ended', () => { sh.state = 'ended'; this.publish(ws); }); handle.on('roster', () => this.publish(ws));
          this.publish(ws);
        } catch (e) { sh.state = 'failed'; const w = shareWhy(e); sh.error = w.error; sh.code = w.code; this.publish(ws); }
        return;
      }
      case 'unshare': { this.stopSharing(ws); send({ t: 'sharing', sharing: null }); this.o.toViewers?.(ws, { t: 'sharing', sharing: null }); return; }
      case 'shareLink': { if (!cur?.handle) return; try { const l = await cur.handle.createShareLink(); cur.link = { url: l.url + l.fragment, expiresAt: l.expires_at }; } catch (e) { cur.hint = shareWhy(e).error; } this.publish(ws); return; }
      case 'shareInvite': {
        if (!cur?.handle || !cur.account) return; const account = cur.account; const spaces = await account.workspaces().catch(() => []); const home = spaces.find((w) => w.name === cur.workspace)?.id ?? spaces[0]?.id; if (!home) return;
        try { const r = (await account.http.call('createInvite', { path: { id: home }, body: { role: 'member', ...(m.email ? { email: m.email } : {}) } } as never)).data as unknown as { url?: string }; cur.invite = { url: r.url ?? '', ...(m.email ? { email: m.email } : {}) }; cur.hint = undefined; }
        catch (e) { const code = (e as { rawCode?: string; status?: number }); cur.hint = code.status === 403 || code.rawCode === 'forbidden' || code.rawCode === 'insufficient_scope' ? 'Inviting people is done in the Centcom web app (Workspace, Members), because this app\'s sign-in is not allowed to change the workspace. People in your workspace can join with the session id.' : shareWhy(e).error; }
        this.publish(ws); return;
      }
      case 'shareDecide': { try { if (m.decision === 'approve') await cur?.bridge?.approve(m.item); else await cur?.bridge?.reject(m.item); } catch { /* the item was already decided or withdrawn */ } this.publish(ws); return; }
      case 'shareAuto': { cur?.bridge?.setAutoApprove(m.on); this.publish(ws); return; }
    }
  }
}

/** What went wrong while sharing, in words for the person. */
export function shareWhy(e: unknown): { error: string; code?: string } {
  const code = (e as { code?: string; rawCode?: string })?.code ?? (e as { rawCode?: string })?.rawCode; const msg = e instanceof Error ? e.message : '';
  if (code === 'entitlement_required' || code === 'session_limit_reached') return { error: 'Your plan does not include sharing over the internet. Upgrade to Pro or Team to share a session.', code: 'entitlement_required' };
  if (code === 'not_signed_in') return { error: 'Sign in first: sharing needs an account.', code };
  if (/fetch failed|ECONNREFUSED|network/i.test(msg) || (e as { name?: string })?.name === 'TransportError') return { error: 'Could not reach the Centcom server. Check your connection and the server address.', code: 'offline' };
  return { error: msg && msg.length < 160 ? msg : 'Sharing did not work. Try again.', ...(code ? { code } : {}) };
}
