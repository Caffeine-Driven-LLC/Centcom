import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VirtualClock } from '@centcom/testkit';
import { FileTrustStore, createPermissionEngine, createRuleStore, nodePermFs, type ApprovalPrompter, type AgentCtx, type ApprovalRequest, type AuditEvent, type PathFs, type PermConfig, type Rule } from '../../src/index.js';

export const req = (o: Partial<ApprovalRequest> = {}): ApprovalRequest => ({ approval_id: 'apr_01JTEST0000000000000000001', agent_id: 'agt_01JTEST0000000000000000001', tool_id: 't1', tool: 'Bash', summary: 'run', command: 'git status', risk: 'medium', ...o });
export function rig(o: { mode?: AgentCtx['mode']; prompter?: ApprovalPrompter; config?: Partial<PermConfig>; fs?: PathFs & typeof nodePermFs; os?: 'posix' | 'win32'; home?: string; root?: string } = {}) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'perm-'))); const root = o.root ?? join(base, 'work'); mkdirSync(root, { recursive: true }); mkdirSync(join(root, '.git', 'info'), { recursive: true }); const home = o.home ?? join(base, 'home'); if (!o.home) mkdirSync(home, { recursive: true }); /* a given home (e.g. a Windows path in a test) is never created on disk */
  const clock = new VirtualClock(); const audit: AuditEvent[] = []; const userRulesPath = join(base, 'cfg', 'permissions.json'); const trust = new FileTrustStore(join(base, 'cfg', 'trust.json'));
  const config: PermConfig = { home, userRulesPath, os: o.os, ...o.config }; const fs = (o.fs ?? nodePermFs) as typeof nodePermFs;
  const rules = createRuleStore({ fs, clock, trust, userRulesPath, audit: (e) => audit.push(e) });
  const engine = createPermissionEngine({ fs, clock, rules, prompter: o.prompter, audit: (e) => audit.push(e), config });
  const ctx: AgentCtx = { agentId: 'agt_01JTEST0000000000000000001', root, mode: o.mode ?? 'ask', engine: 'claude-code', owner: 'mem_owner' };
  return { base, root, home, clock, audit, engine, rules, trust, ctx, userRulesPath, config, fs, mkLink: (name: string, target: string) => { symlinkSync(target, join(root, name)); return join(root, name); }, write: (rel: string, text = 'x') => { const p = join(root, rel); mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, text); return p; } };
}
export const allow = (tool: string, matcher?: Rule['matcher']) => ({ tool, action: 'allow' as const, scope: 'session' as const, ...(matcher ? { matcher } : {}) });
export const denyRule = (tool: string, matcher?: Rule['matcher']) => ({ tool, action: 'deny' as const, scope: 'session' as const, ...(matcher ? { matcher } : {}) });
/** The engine resolves symlinks with real file system calls before it registers a pending approval, so give it a short real moment. */
export const tick = () => new Promise<void>((r) => setTimeout(r, 30));
