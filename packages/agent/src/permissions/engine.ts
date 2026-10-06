import { posix, relative, win32 } from 'node:path';
import type { ApprovalRequest, PermissionGate, Risk } from '../types.js';
import type { PathFs } from './paths.js';
import { isCredentialPath, isGitInternal, isInside, realPath } from './paths.js';
import { actionKind, evaluateRules } from './rules.js';
import { alwaysPrefix, readShell } from './shell.js';
import type { RuleStore } from './store.js';
import type { AgentCtx, ApprovalDecision, ApprovalPrompter, Approver, AuditEvent, Decision, MemberRef, PendingApproval, PermConfig, RiskClassifier, Rule } from './types.js';
import type { RunnerClock } from '../runner/types.js';

export interface PermissionEngineDeps { fs: PathFs; clock: RunnerClock; rules: RuleStore; prompter?: ApprovalPrompter; classifier?: RiskClassifier; audit?: (e: AuditEvent) => void; config: PermConfig }
export interface PermissionEngine {
  decide(req: ApprovalRequest, ctx: AgentCtx): Promise<Decision>; handle(req: ApprovalRequest, ctx: AgentCtx): Promise<ApprovalDecision>;
  resolveRemote(approvalId: string, d: ApprovalDecision, from: MemberRef): { accepted: boolean; reason?: string }; pending(): PendingApproval[]; rules: RuleStore;
  cancel(approvalId: string, reason?: string): boolean; cancelAgent(agentId: string): number; bypassActive(ctx: Pick<AgentCtx, 'mode'>): boolean;
}
const DEFAULT_TIMEOUT = 600_000; const KNOWN = new Set<string>(['claude-code', 'codex', 'fake']);
const deny = (reason: string, hard = false, rule?: string): Decision => ({ action: 'deny', reason, ...(hard ? { hard } : {}), ...(rule ? { rule } : {}) });

export function createPermissionEngine(d: PermissionEngineDeps): PermissionEngine {
  const os = d.config.os ?? 'posix'; const timeout = d.config.approvalTimeoutMs ?? DEFAULT_TIMEOUT; const audit = (e: AuditEvent) => { try { d.audit?.(e); } catch { /* an audit sink must never break a decision */ } };
  interface Entry { p: PendingApproval; ctx: AgentCtx; req: ApprovalRequest; resolve: (r: ApprovalDecision) => void; timer: unknown; ac: AbortController; promise: Promise<ApprovalDecision> }
  const waiting = new Map<string, Entry>();

  async function hardDeny(req: ApprovalRequest, ctx: AgentCtx, rootReal: string): Promise<string | undefined> {
    const kind = actionKind(req.tool, req.command); const writes: string[] = []; const touched: string[] = [];
    if (req.path) (kind === 'edit' ? writes : touched).push(req.path);
    if (req.command) { const s = readShell(req.command); writes.push(...s.writeTargets); touched.push(...s.pathWords); }
    for (const p of [...writes, ...touched]) { const real = await realPath(p, ctx.root, d.config, d.fs); if (isCredentialPath(real, os)) return 'credential_path'; }
    for (const p of writes) {
      const real = await realPath(p, ctx.root, d.config, d.fs); if (!isInside(rootReal, real, os)) return 'outside_root';
      const rel = (os === 'win32' ? win32 : posix).relative(rootReal, real); if (isGitInternal(rel, os)) return 'git_internals';
    }
    return undefined;
  }
  const risk = (req: ApprovalRequest): Risk => { try { return d.classifier ? d.classifier.classify(req) : req.risk ?? 'medium'; } catch { return 'medium'; } };

  async function decide(req: ApprovalRequest, ctx: AgentCtx): Promise<Decision> {
    if (ctx.stopped) return deny('agent_stopped', true);
    const rootReal = await realPath(ctx.root, ctx.root, d.config, d.fs); const hard = await hardDeny(req, ctx, rootReal); if (hard) { audit({ type: 'hard_deny', agent_id: ctx.agentId, approval_id: req.approval_id, reason: hard }); return deny(hard, true); }
    const kind = actionKind(req.tool, req.command); let inside = true; let relPath: string | undefined;
    if (req.path) { const real = await realPath(req.path, ctx.root, d.config, d.fs); inside = isInside(rootReal, real, os); relPath = inside ? relative(rootReal, real).split('\\').join('/') : real; }
    const hit = evaluateRules(d.rules.list(ctx.root), { req, engine: ctx.engine, relPath }); if (hit) return { action: hit.action, reason: `rule:${hit.rule.id}`, rule: hit.rule.id };
    const mode = ctx.mode === 'bypass' && !d.config.bypassEnabled ? 'ask' : ctx.mode;
    if (ctx.engine !== undefined && !KNOWN.has(ctx.engine)) return { action: 'ask', reason: 'unknown_engine' };
    switch (mode) {
      case 'bypass': return { action: 'allow', reason: 'bypass' };
      case 'auto-low-risk': return risk(req) === 'low' ? { action: 'allow', reason: 'low_risk' } : { action: 'ask', reason: 'risk' };
      case 'plan': return kind === 'read' && inside ? { action: 'allow', reason: 'read_in_root' } : kind === 'edit' || kind === 'shell' ? deny('plan_mode') : { action: 'ask', reason: 'plan_other' };
      case 'accept-edits': return (kind === 'read' || kind === 'edit') && inside ? { action: 'allow', reason: kind === 'edit' ? 'accept_edits' : 'read_in_root' } : { action: 'ask', reason: 'mode' };
      default: return kind === 'read' && inside ? { action: 'allow', reason: 'read_in_root' } : { action: 'ask', reason: 'mode' };
    }
  }

  async function ruleFromApproval(req: ApprovalRequest, ctx: AgentCtx, scope: 'session' | 'project'): Promise<void> {
    const kind = actionKind(req.tool, req.command); let matcher: Rule['matcher'] | undefined;
    if (kind === 'shell') { const prefix = req.command ? alwaysPrefix(req.command) : undefined; if (!prefix) return; matcher = { command: prefix }; }
    else if (req.path) { const rootReal = await realPath(ctx.root, ctx.root, d.config, d.fs); const real = await realPath(req.path, ctx.root, d.config, d.fs); if (!isInside(rootReal, real, os)) return; const dir = posix.dirname(relative(rootReal, real).split('\\').join('/')); matcher = { path_glob: dir === '.' ? '*' : `${dir}/**` }; }
    else if (kind !== 'other') return; // a read or edit without a path cannot be limited to a folder: no rule
    try { await d.rules.add({ tool: req.tool, action: 'allow', scope, ...(ctx.engine ? { engine: ctx.engine } : {}), ...(matcher ? { matcher } : {}) }, ctx.root); }
    catch { if (scope === 'project') await d.rules.add({ tool: req.tool, action: 'allow', scope: 'session', ...(ctx.engine ? { engine: ctx.engine } : {}), ...(matcher ? { matcher } : {}) }, ctx.root).catch(() => undefined); }
  }

  function finish(id: string, dec: ApprovalDecision, by: string, kind: AuditEvent['type'] = 'decided'): boolean {
    const e = waiting.get(id); if (!e) return false; waiting.delete(id); d.clock.clearTimeout(e.timer as never); e.ac.abort(); e.resolve(dec); audit({ type: kind, approval_id: id, agent_id: e.p.agent_id, by, decision: dec.decision, ...(dec.reason ? { reason: dec.reason } : {}) });
    if (dec.decision === 'approve' && (dec.scope === 'always' || dec.scope === 'session')) void ruleFromApproval(e.req, e.ctx, dec.scope === 'always' ? 'project' : 'session').catch(() => undefined); return true;
  }

  async function handle(req: ApprovalRequest, ctx: AgentCtx): Promise<ApprovalDecision> {
    let dec: Decision; try { dec = await decide(req, ctx); } catch { dec = deny('error'); }
    if (dec.action === 'allow') return { decision: 'approve', scope: 'once', reason: dec.reason }; if (dec.action === 'deny') return { decision: 'deny', scope: 'once', reason: dec.reason };
    if (d.config.headless) return { decision: 'deny', scope: 'once', reason: 'headless' };
    const existing = waiting.get(req.approval_id); if (existing) return existing.promise;
    const approver: Approver = d.config.defaultApprover ?? 'host'; const expires = d.clock.now() + timeout; const ac = new AbortController(); let resolve!: (r: ApprovalDecision) => void; const promise = new Promise<ApprovalDecision>((r) => { resolve = r; });
    const p: PendingApproval = { approval_id: req.approval_id, agent_id: ctx.agentId, tool: req.tool, summary: req.summary, risk: risk(req), expires_at: new Date(expires).toISOString(), approver, ...(req.command ? { command: req.command } : {}), ...(req.cwd ? { cwd: req.cwd } : {}), ...(req.path ? { path: req.path } : {}), ...(ctx.engine ? { engine: ctx.engine } : {}) };
    const timer = d.clock.setTimeout(() => { finish(req.approval_id, { decision: 'deny', scope: 'once', reason: 'expired' }, 'timer', 'expired'); }, timeout);
    waiting.set(req.approval_id, { p, ctx, req, resolve, timer, ac, promise });
    if (d.prompter) void Promise.resolve().then(() => d.prompter!.prompt(p, ac.signal)).then((r) => { finish(req.approval_id, r && (r.decision === 'approve' || r.decision === 'deny') ? r : { decision: 'deny', scope: 'once', reason: 'bad_answer' }, 'prompter'); }, () => { finish(req.approval_id, { decision: 'deny', scope: 'once', reason: 'prompter_error' }, 'prompter'); });
    return promise;
  }

  return {
    decide, handle, rules: d.rules, pending: () => [...waiting.values()].map((e) => e.p), bypassActive: (c) => !!d.config.bypassEnabled && c.mode === 'bypass',
    resolveRemote(id, dec, from) {
      const e = waiting.get(id); if (!e) return { accepted: false, reason: 'unknown_or_decided' };
      const ok = from.role === 'host' || from.delegated === true || (e.p.approver === 'any_editor' && from.role === 'editor') || (e.p.approver === 'owner' && !!e.ctx.owner && from.id === e.ctx.owner);
      if (!ok) { audit({ type: 'remote_rejected', approval_id: id, agent_id: e.p.agent_id, by: from.id }); return { accepted: false, reason: 'not_approver' }; }
      audit({ type: 'remote_accepted', approval_id: id, agent_id: e.p.agent_id, by: from.id }); return { accepted: finish(id, dec, from.id) };
    },
    cancel: (id, reason = 'cancelled') => finish(id, { decision: 'deny', scope: 'once', reason }, 'cancel', 'cancelled'),
    cancelAgent(agentId) { let n = 0; for (const [id, e] of [...waiting]) if (e.p.agent_id === agentId && finish(id, { decision: 'deny', scope: 'once', reason: 'cancelled' }, 'cancel', 'cancelled')) n++; return n; },
  };
}
/** What gets injected into an engine as its `approvalGate`. */
export const createPermissionGate = (engine: PermissionEngine, ctxFor: (agentId: string) => AgentCtx): PermissionGate => ({ decide: (req) => engine.handle(req, ctxFor(req.agent_id)) });
/** The wire form of a pending approval: the clear part has ids, risk, expiry and who may decide; the command and paths stay in the secret part. */
export const approvalToWire = (p: PendingApproval) => ({ p: { approval_id: p.approval_id, agent_id: p.agent_id, risk: p.risk, expires_at: p.expires_at, approver: p.approver }, ct: { summary: p.summary, ...(p.command ? { command: p.command } : {}), ...(p.cwd ? { cwd: p.cwd } : {}) } });
