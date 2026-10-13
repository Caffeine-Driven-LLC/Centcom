/**
 * Sharing from the terminal app: `/share` starts a session for the conversation on screen, `/share invite [email]` and `/share link`
 * hand out ways in, and what editors ask for arrives as a notice that `/share run <n>` or `/share no <n>` answers. The
 * conversation stays on this computer; the same HostBridge as the desktop app does the work.
 */
import { NetStateMonitor, NotificationsClient, render as renderNotification, type NetState, type SessionHandle } from '@centcom/net';
import { defaultDeps, stateDir } from '@centcom/config';
import { startUsageReporting, type UsageLink } from './usage-link.js';
import type { AppController } from '../controller.js';
import type { Account } from './account.js';
import { HostBridge, startBranchBridge, untilLive } from './host-bridge.js';
import { renderTeam, renderTranscript } from './team-text.js';

export class ShareSession {
  private handle?: SessionHandle; private bridge?: HostBridge; private net?: NetStateMonitor; private lastNet?: NetState; private usage?: UsageLink; private inbox?: NotificationsClient; private known = new Set<string>(); private order: string[] = []; private workspace = '';
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
        case '': case 'start': return await this.start(rest[0]?.toLowerCase() === 'branch' ? 'branch' : 'command_post');
        case 'branch': return await this.start('branch');
        case 'join': return await this.joinBranch(rest[0]);
        case 'team': return this.team();
        case 'watch': return this.watch(rest.join(' '));
        case 'activity': { if (!this.bridge || this.bridge.mode !== 'branch') return this.needBranch(); const on = rest[0] ? rest[0] === 'on' : !this.bridge.sharingActivity; this.bridge.setShareActivity(on); ctl.toast('info', on ? 'The team sees what your agent says and does.' : 'Your agent\'s messages are not shared. State, branch and locks still are.'); return; }
        case 'handoff': return this.handoff(rest);
        case 'inbox': return await this.inboxCommand(rest[0]);
        case 'status': return this.status();
        case 'invite': return await this.invite(rest[0]);
        case 'link': return await this.link();
        case 'auto': { if (!this.bridge) return this.need(); const on = rest[0] ? rest[0] === 'on' : !this.bridge.autoApproving; this.bridge.setAutoApprove(on); ctl.toast('info', on ? 'Requests from editors run without asking you.' : 'Requests from editors wait for you.'); return; }
        case 'run': case 'no': return await this.decide(sub.toLowerCase() === 'run', rest[0]);
        case 'stop': return await this.stop();
        default: ctl.toast('warn', 'Use /share, /share branch, /share join <id|link>, /team, /share activity [on|off], /share handoff <number> [note], /share invite [email], /share link, /share status, /share run <n>, /share no <n>, /share auto or /share stop.');
      }
    } catch (e) { ctl.notice('error', 'Sharing', this.why(e)); }
  }
  private need(): void { this.ctl.toast('warn', 'This conversation is not shared yet. Type /share to start.'); }

  private needBranch(): void { this.ctl.toast('warn', 'This is not a session where everyone runs their own agent. Start one with /share branch.'); }
  private async start(mode: 'command_post' | 'branch' = 'command_post'): Promise<void> {
    const ctl = this.ctl; if (this.live) return this.status();
    if (ctl.state.busy) { ctl.toast('warn', 'Cento is still working. Try again when it is done.'); return; }
    ctl.toast('info', 'Starting the session…'); const st = await this.account.status();
    if (!st.signedIn) { ctl.notice('warn', 'Sharing needs an account', 'Run `centcom login` in a terminal, approve it in your browser, then type /share again.'); return; }
    const sessions = await this.account.sessions(); const spaces = await this.account.workspaces(); const home = st.me?.workspace?.id ?? spaces[0]?.id; if (!home) { ctl.notice('error', 'Sharing', 'Your account has no workspace to share in.'); return; }
    this.workspace = spaces.find((w) => w.id === home)?.name ?? home; const name = ctl.state.cwd.replace(/\/+$/, '').split('/').pop() || 'session';
    const handle = await sessions.createSession({ name, workspace: home, ...(mode === 'branch' ? { mode: 'branch' as const } : {}) }); this.handle = handle;
    const branch = mode === 'branch' && handle.mode === 'branch'; if (mode === 'branch' && !branch) ctl.notice('warn', 'This server does not support everyone running their own agent yet', 'The session works as a command post instead: you run the agent and others ask.');
    this.watchNet(handle);
    if (branch) this.bridge = this.branch(handle); else { this.bridge = new HostBridge(ctl, handle, { onChange: () => this.onChange(), onError: () => undefined }); this.bridge.start(); }
    handle.on('ended', () => { ctl.notice('info', 'The shared session ended.'); this.drop(); });
    if (branch) { ctl.notice('ok', `Sharing ${name}: everyone runs their own agent`, `Session ${handle.id} in ${this.workspace}.\nEach person joins with their own copy of the project: /share join ${handle.id} (or centcom join, for a watch-only view). /team shows who is working on what; /share activity off keeps your agent's messages private (state, branch and locks are always shared).\n/share invite <email> makes an invite link for one person.`); return; }
    ctl.notice('ok', `Sharing ${name}`, `Session ${handle.id} in ${this.workspace}.\n/share invite <email> makes an invite link for one person, /share link makes a watch-only link, /share stop ends it.\nPeople in your workspace can join with: centcom join ${handle.id}`);
  }
  /** This person's own agent in a branch-mode session. */
  private branch(handle: SessionHandle): HostBridge {
    return startBranchBridge(this.ctl, handle, { onChange: () => this.onChange(), onError: () => undefined, onConflict: () => { const line = this.bridge?.team?.digestFor(handle.me.id)[0] ?? "A teammate's agent is changing a file your agent is changing."; this.ctl.notice('warn', 'Two agents are working on the same file', `${line} Your branches will conflict there; tell them, or pick another file.`); } });
  }
  /** `/share join <id|link>`: this conversation joins somebody's session with its own agent (a command post is read with `centcom join`). */
  private async joinBranch(input?: string): Promise<void> {
    const ctl = this.ctl; if (!input) { ctl.toast('warn', 'Usage: /share join <session id or invite link>'); return; } if (this.live) { ctl.toast('warn', 'This conversation is already in a session. /share stop leaves it.'); return; }
    const st = await this.account.status(); if (!st.signedIn) { ctl.notice('warn', 'Joining needs an account', 'Run `centcom login` in a terminal first.'); return; }
    const { handle } = await this.account.joinMember(input); if (handle.mode !== 'branch') { await handle.leave().catch(() => undefined); ctl.notice('warn', 'That session is a command post', `There the host runs the agent. Watch and ask with: centcom join ${input}`); return; }
    ctl.toast('info', 'Joining…'); if (!(await untilLive(handle))) { await handle.leave().catch(() => undefined); ctl.notice('error', 'Could not join', 'The host did not let this computer in yet (it has to be online to hand out the keys). Try again in a moment.'); return; }
    this.handle = handle; this.watchNet(handle); this.bridge = this.branch(handle); handle.on('ended', () => { ctl.notice('info', 'The shared session ended.'); this.drop(); });
    ctl.notice('ok', 'You are in the session with your own agent', `Your agent works on ${ctl.state.cwd}. /team shows who is working on what; /share stop leaves.`);
  }
  /** `/team` (also `/share team`): everybody's agents. */
  /** `/watch [number|name]`: read-only view of a teammate's transcript, as far as they share their agent's activity. */
  watch(who: string): void {
    const t = this.bridge?.team; if (!t) { this.ctl.toast('warn', "No team yet. In a session where everyone runs their own agent (/share branch), /watch shows a teammate's agent."); return; }
    const others = t.snapshot().members.filter((m) => !m.you && m.agents.length); if (!others.length) { this.ctl.toast('info', 'Nobody else has an agent here yet.'); return; }
    const q = who.trim().toLowerCase(); const n = Number(q); const m = q ? (Number.isInteger(n) && n >= 1 ? others[n - 1] : others.find((x) => x.name.toLowerCase().startsWith(q))) : others.length === 1 ? others[0] : undefined;
    if (!m) { this.ctl.toast('warn', `Whose agent? ${others.map((x, i) => `${i + 1} ${x.name}`).join(', ')}: /watch <number or name>`); return; }
    const a = m.agents.filter((x) => !x.exit).at(-1) ?? m.agents.at(-1)!; const text = renderTranscript(t.transcript(a.id), m.name);
    if (!text) { this.ctl.notice('info', `${m.name}'s agent`, a.sharing === false ? `${m.name} has not shared what their agent says and does (they can turn it on with /share activity on).` : 'Nothing to show yet.'); return; }
    this.ctl.notice('info', `${m.name}'s agent (read only)`, text);
  }
  team(): void { const t = this.bridge?.team; if (!t) { this.ctl.toast('warn', 'No team yet. In a session where everyone runs their own agent (/share branch), /team shows who is working on what.'); return; } this.ctl.notice('info', 'Team', renderTeam(t.snapshot())); }
  private handoff(rest: string[]): void {
    const t = this.bridge?.team; if (!this.bridge || !t) return this.needBranch(); const people = t.snapshot().members.filter((m) => !m.you); const n = Number(rest[0]); const to = people[n - 1];
    if (!to) { this.ctl.toast('warn', people.length ? `Hand your work to whom? ${people.map((m, i) => `${i + 1} ${m.name}`).join(', ')}: /share handoff <number> [note]` : 'Nobody else is here.'); return; }
    this.bridge.offerHandoff(to.id, rest.slice(1).join(' ') || undefined); this.ctl.toast('ok', `Offered your work to ${to.name}.`);
  }
  /** The inbox client for this account: it polls only while a session is shared; `/inbox` can look at any time. */
  private inboxClient(): NotificationsClient {
    return (this.inbox ??= new NotificationsClient({
      http: this.account.http, clock: { now: () => Date.now(), setTimeout: (f, ms) => { const h = setTimeout(f, ms); h.unref?.(); return h; }, clearTimeout: (h) => clearTimeout(h as unknown as NodeJS.Timeout) }, stateDir: stateDir(defaultDeps()),
      os: { show: async () => false /* the terminal app does not raise desktop notices: the line above the prompt does the job */ }, active: () => this.lastNet !== 'offline' && this.lastNet !== 'backend-down',
    }));
  }
  /** `/inbox` lists what is unread, in the app's own words; `/inbox read` marks everything read. */
  private async inboxCommand(sub?: string): Promise<void> {
    const ctl = this.ctl; const st = await this.account.status(); if (!st.signedIn) { ctl.notice('warn', 'The inbox needs an account', 'Run `centcom login` in a terminal first.'); return; }
    const inbox = this.inboxClient();
    if (sub === 'read') { await inbox.markAllRead(); ctl.toast('ok', 'Everything is marked read.'); return; }
    const lines: string[] = []; let n = 0; for await (const item of inbox.list({ unread: true })) { if (++n > 10) break; const t = renderNotification(item); lines.push(`${n}. ${t.title}: ${t.body}`); }
    if (!n) { ctl.toast('info', 'Your inbox is empty.'); return; }
    ctl.notice('info', n > 10 ? 'Inbox (the 10 newest unread)' : `Inbox (${n} unread)`, `${lines.join('\n')}\n/inbox read marks them all read.`);
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
  /** From the moment a session is live, the link to the hosted service is watched: the sockets first, the status feed as a second opinion. */
  private watchNet(handle: SessionHandle): void {
    this.net?.stop(); this.lastNet = undefined; void this.usage?.stop();
    // usage of this conversation while it is shared is reported (informationally); the service's notices reach the notice line, and their action keys do something
    this.usage = startUsageReporting({ http: this.account.http, ledger: this.ctl.ledger, localSessionId: this.ctl.state.sessionId, hostedSessionId: handle.id });
    const inbox = this.inboxClient(); inbox.on('new', (n) => this.ctl.toast('info', `Inbox: ${renderNotification(n).title}`, undefined, { key: `inbox:${n.id}` })); inbox.start();
    const usage = this.usage; handle.on('notice', (n) => { usage.notice(n as never); this.ctl.showNotice(n as never); });
    this.ctl.onToastAction((id) => { if (id === 'billing.upgrade') this.ctl.notice('info', 'Upgrade your plan', 'Open https://centcom.dev/billing, or the billing page of your workspace in the web app.'); else if (id === 'update.show') void this.ctl.runCommand('/update'); });
    const monitor = new NetStateMonitor({ sessions: () => [handle], status: () => this.account.plain.getStatus(), clock: { now: () => Date.now(), setTimeout: (f, ms) => { const h = setTimeout(f, ms); h.unref?.(); return h; }, clearTimeout: (h) => clearTimeout(h as unknown as NodeJS.Timeout) } });
    monitor.on('change', (s, prev) => { this.lastNet = s; this.ctl.setNet(s, prev); }); this.net = monitor; this.ctl.setNet('online'); monitor.start();
  }
  private drop(): void { this.inbox?.stop(); void this.usage?.stop(); this.usage = undefined; this.net?.stop(); this.net = undefined; this.ctl.setNet(undefined); this.bridge?.stop(); this.bridge = undefined; this.handle = undefined; this.known.clear(); this.order = []; }
  /** The app is closing. */
  close(): void { const h = this.handle; this.drop(); void h?.leave().catch(() => undefined); }
}
