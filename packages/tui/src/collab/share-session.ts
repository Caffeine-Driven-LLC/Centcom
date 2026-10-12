/**
 * Sharing from the terminal app: `/share` starts a session for the conversation on screen, `/share invite [email]` and `/share link`
 * hand out ways in, and what editors ask for arrives as a notice that `/share run <n>` or `/share no <n>` answers. The
 * conversation stays on this computer; the same HostBridge as the desktop app does the work.
 */
import type { SessionHandle } from '@centcom/net';
import type { AppController } from '../controller.js';
import type { Account } from './account.js';
import { HostBridge } from './host-bridge.js';

export class ShareSession {
  private handle?: SessionHandle; private bridge?: HostBridge; private known = new Set<string>(); private order: string[] = []; private workspace = '';
  constructor(private readonly ctl: AppController, private readonly account: Account) {}
  get live(): boolean { return !!this.handle && this.handle.state !== 'ended'; }

  /** Words for what went wrong while sharing. */
  private why(e: unknown): string {
    const code = (e as { code?: string; rawCode?: string })?.code ?? (e as { rawCode?: string })?.rawCode; const msg = e instanceof Error ? e.message : '';
    if (code === 'entitlement_required' || code === 'session_limit_reached') return 'Your plan does not include sharing over the internet. Upgrade to Pro or Team to share a session.';
    if (code === 'not_signed_in') return 'Sign in first: run `centcom login` in a terminal, then try again.';
    if (/fetch failed|ECONNREFUSED|network/i.test(msg)) return 'Could not reach the Centcom server. Check your connection and the server address.';
    return msg && msg.length < 160 ? msg : 'Sharing did not work. Try again.';
  }

  async handleCommand(arg: string): Promise<void> {
    const [sub = '', ...rest] = arg.trim().split(/\s+/).filter(Boolean); const ctl = this.ctl;
    try {
      switch (sub.toLowerCase()) {
        case '': case 'start': return await this.start();
        case 'status': return this.status();
        case 'invite': return await this.invite(rest[0]);
        case 'link': return await this.link();
        case 'auto': { if (!this.bridge) return this.need(); const on = rest[0] ? rest[0] === 'on' : !this.bridge.autoApproving; this.bridge.setAutoApprove(on); ctl.toast('info', on ? 'Requests from editors run without asking you.' : 'Requests from editors wait for you.'); return; }
        case 'run': case 'no': return await this.decide(sub.toLowerCase() === 'run', rest[0]);
        case 'stop': return await this.stop();
        default: ctl.toast('warn', 'Use /share, /share invite [email], /share link, /share status, /share run <n>, /share no <n>, /share auto or /share stop.');
      }
    } catch (e) { ctl.notice('error', 'Sharing', this.why(e)); }
  }
  private need(): void { this.ctl.toast('warn', 'This conversation is not shared yet. Type /share to start.'); }

  private async start(): Promise<void> {
    const ctl = this.ctl; if (this.live) return this.status();
    if (ctl.state.busy) { ctl.toast('warn', 'Cento is still working. Try again when it is done.'); return; }
    ctl.toast('info', 'Starting the session…'); const st = await this.account.status();
    if (!st.signedIn) { ctl.notice('warn', 'Sharing needs an account', 'Run `centcom login` in a terminal, approve it in your browser, then type /share again.'); return; }
    const sessions = await this.account.sessions(); const spaces = await this.account.workspaces(); const home = st.me?.workspace?.id ?? spaces[0]?.id; if (!home) { ctl.notice('error', 'Sharing', 'Your account has no workspace to share in.'); return; }
    this.workspace = spaces.find((w) => w.id === home)?.name ?? home; const name = ctl.state.cwd.replace(/\/+$/, '').split('/').pop() || 'session';
    const handle = await sessions.createSession({ name, workspace: home }); this.handle = handle;
    this.bridge = new HostBridge(ctl, handle, { onChange: () => this.onChange(), onError: () => undefined }); this.bridge.start();
    handle.on('ended', () => { ctl.notice('info', 'The shared session ended.'); this.drop(); });
    ctl.notice('ok', `Sharing ${name}`, `Session ${handle.id} in ${this.workspace}.\n/share invite <email> makes an invite link for one person, /share link makes a watch-only link, /share stop ends it.\nPeople in your workspace can join with: centcom join ${handle.id}`);
  }
  private status(): void {
    if (!this.handle || !this.live) return this.need(); const people = this.handle.roster().map((m) => `${m.name || 'Someone'} (${m.role === 'host' ? 'you, host' : m.role === 'editor' ? 'can edit' : 'view only'})`).join(', ');
    this.ctl.notice('info', `Shared session ${this.handle.id}`, `In it: ${people || 'only you'}.${this.bridge?.autoApproving ? ' Requests from editors run without asking you.' : ''}${this.bridge?.pending().length ? ` ${this.bridge.pending().length} request(s) wait for you: /share run <n> or /share no <n>.` : ''}`);
  }
  private async invite(email?: string): Promise<void> {
    if (!this.handle) return this.need(); if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { this.ctl.toast('warn', 'That does not look like an e-mail address.'); return; }
    const r = await this.account.inviteToSession(this.handle.id, { role: 'editor', ...(email ? { email } : {}) }); this.ctl.notice('ok', `Invite${email ? ` for ${email}` : ''}`, `${r.url}\nThe person opens it in Centcom (or runs: centcom join ${r.url}) and can ask your agent for things; you decide what runs.`);
  }
  private async link(): Promise<void> {
    if (!this.handle) return this.need(); const l = await this.handle.createShareLink(); this.ctl.notice('ok', 'Watch-only link', `${l.url}${l.fragment}\nAnyone with it can watch for an hour, without an account. Treat it like a password.`);
  }
  private onChange(): void {
    const b = this.bridge; if (!b) return; for (const p of b.pending()) { if (this.known.has(p.item)) continue; this.known.add(p.item); this.order.push(p.item); const n = this.order.length; this.ctl.notice('warn', `${p.from} asks: ${p.text.length > 200 ? p.text.slice(0, 200) + '…' : p.text}`, `Type /share run ${n} to let the agent do it, or /share no ${n}.`); this.ctl.toast('warn', `${p.from} asked for something (/share run ${n})`); }
  }
  private async decide(run: boolean, n?: string): Promise<void> {
    const b = this.bridge; if (!b) return this.need(); const open = b.pending(); const idx = n ? Number(n) : open.length === 1 ? this.order.indexOf(open[0]!.item) + 1 : 0;
    const item = this.order[idx - 1]; if (!item || !open.some((p) => p.item === item)) { this.ctl.toast('warn', open.length ? `Which one? ${open.map((p) => `${this.order.indexOf(p.item) + 1}`).join(', ')}` : 'Nothing is waiting.'); return; }
    if (run) await b.approve(item); else await b.reject(item); this.ctl.toast('ok', run ? 'Running it.' : 'Declined.');
  }
  private async stop(): Promise<void> { if (!this.handle) return this.need(); const h = this.handle; this.drop(); await h.end().catch(() => h.leave().catch(() => undefined)); this.ctl.notice('info', 'Stopped sharing'); }
  private drop(): void { this.bridge?.stop(); this.bridge = undefined; this.handle = undefined; this.known.clear(); this.order = []; }
  /** The app is closing. */
  close(): void { const h = this.handle; this.drop(); void h?.leave().catch(() => undefined); }
}
