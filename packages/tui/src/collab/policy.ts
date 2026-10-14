/**
 * The who-pays gate (lane C105, CT-PROVIDER) as the sharing code uses it. `evaluatePathGate` decides; this adds what a running app needs around it:
 * the engine and the effective login kind of the moment (an unknown kind is looked up, and stays "unknown", i.e. a subscription, when that fails),
 * the host's own confirmation (asked through the host's UI, held per session in memory only), and the words for a block.
 * Everything here fails closed: a flags client that is missing, throws or has not loaded yields the defaults (a subscription command post stays blocked).
 */
import { dropHostConfirmations, evaluatePathGate, hostConfirmed, requestHostConfirmation, type AuditNote, type FlagSource, type GatePath, type GateResult, type LoginKind, type SessionMode } from '@centcom/agent';
import { MESSAGES } from '../provider/messages.js';

export interface PolicyOptions {
  /** The flags client (C067). Absent or not loaded: the defaults apply. */ flags?: FlagSource;
  /** Shows the subscription notice to the host (their own UI) and resolves true on `y`. Absent: a command post that needs the host's confirmation stays blocked. */ confirm?(q: { engine: string; sessionId: string }): Promise<boolean>;
  /** Receives `provider.cp_subscription.confirmed`. */ audit?(note: AuditNote): void;
  /** Looks up the login kind before the engine has reported it (C104 detection). */ detectLoginKind?(engine: string): Promise<LoginKind>;
  /** Tells the host that something was not run, in words. Called at most once per distinct block. */ onBlocked?(b: BlockedInfo): void;
}
export interface BlockedInfo { path: GatePath; code: 'provider_policy_blocked' | 'provider_method_disabled' | 'host_confirmation'; title: string; detail: string; noticeKey: string }
export type Blocked = Extract<GateResult, { allowed: false }>;

/** The words for a block: what happened, and what the host can do about it. */
export function describeBlock(path: GatePath, r: Blocked): BlockedInfo {
  if ('needs' in r) return { path, code: 'host_confirmation', title: MESSAGES['provider.blocked.confirm_title'](), detail: MESSAGES['provider.blocked.confirm_options'](), noticeKey: 'provider.cp_subscription.notice' };
  if (r.error === 'provider_method_disabled') return { path, code: r.error, title: MESSAGES['provider.blocked.disabled_title'](), detail: `${MESSAGES['provider.blocked.method_disabled']()} ${MESSAGES['provider.blocked.disabled_options']()}`, noticeKey: r.noticeKey };
  return { path, code: r.error, title: MESSAGES['provider.blocked.title'](), detail: `${MESSAGES['provider.blocked.cp_subscription']()} ${MESSAGES['provider.blocked.options']()}`, noticeKey: r.noticeKey };
}

export interface GateContext { sessionId(): string; engine(): string; mode: SessionMode; /** What the engine reported (`unknown` before its first turn). */ loginKind(): LoginKind }
export class PolicyGate {
  private asking?: Promise<boolean>; private told = new Set<string>();
  constructor(private readonly o: PolicyOptions, private readonly ctx: GateContext) {}
  private async kind(engine: string, other: boolean): Promise<LoginKind> {
    let k: LoginKind = 'unknown'; if (!other) { try { k = this.ctx.loginKind(); } catch { k = 'unknown'; } } // the kind the running engine reported says nothing about another engine
    if (k === 'unknown' && this.o.detectLoginKind) { try { k = await this.o.detectLoginKind(engine); } catch { k = 'unknown'; } }
    return k;
  }
  /** Decides without asking anybody. */
  async peek(path: GatePath, engineOverride?: string): Promise<GateResult> {
    try { const engine = engineOverride ?? this.ctx.engine(); return evaluatePathGate(path, { engine, mode: this.ctx.mode, loginKind: await this.kind(engine, engine !== this.ctx.engine()), ...(this.o.flags ? { flags: this.o.flags } : {}), hostConfirmed: hostConfirmed(this.ctx.sessionId(), engine) }); }
    catch { return { allowed: false, error: 'provider_policy_blocked', state: 'provider-policy-blocked', noticeKey: 'provider.blocked.cp_subscription' }; }
  }
  /** Decides; when only the host's confirmation is missing and `ask` is set, asks the host (one question at a time) and decides again. */
  async check(path: GatePath, ask = true, engine?: string): Promise<GateResult> {
    let r = await this.peek(path, engine);
    if (!r.allowed && 'needs' in r && ask && this.o.confirm) {
      const sessionId = this.ctx.sessionId(); const askEngine = r.engine;
      this.asking ??= requestHostConfirmation({ ui: { confirm: async () => this.o.confirm!({ engine: askEngine, sessionId }) }, audit: (n) => { try { this.o.audit?.(n); } catch { /* an audit sink must not break the gate */ } }, sessionId }, askEngine).finally(() => { this.asking = undefined; });
      if (await this.asking) r = await this.peek(path, engine);
    }
    return r;
  }
  /** Tells the host once per distinct block. */
  tell(path: GatePath, r: Blocked): BlockedInfo { const b = describeBlock(path, r); const key = `${b.code}:${path}`; if (!this.told.has(key)) { this.told.add(key); try { this.o.onBlocked?.(b); } catch { /* ignore */ } } return b; }
  /** Forget what was told (the situation changed: a flag flipped, a new engine). */
  retell(): void { this.told.clear(); }
  /** The host role moved, or the session ended: the confirmation goes with it. */
  drop(): void { dropHostConfirmations(this.ctx.sessionId()); }
}

/** Before a command-post session is created: a hard block (switched off, or a subscription login with the flag off) stops it without asking anybody. */
export async function preflightShare(o: PolicyOptions, ctl: { state: { engineId: string; agents: { mine: boolean; loginKind: LoginKind }[] } }): Promise<GateResult> {
  const g = new PolicyGate(o, { sessionId: () => '(new)', engine: () => ctl.state.engineId, mode: 'command_post', loginKind: () => ctl.state.agents.find((a) => a.mine)?.loginKind ?? 'unknown' });
  const r = await g.peek('new_session'); return !r.allowed && 'needs' in r ? { allowed: true } : r; /* a missing confirmation is asked once the session exists */
}
