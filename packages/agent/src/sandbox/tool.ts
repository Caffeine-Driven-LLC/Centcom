import type { ApprovalRequest, Risk } from '../types.js';
import type { ToolKind } from '../state/mapping.js';
import { toolKind } from '../state/mapping.js';
import { classifyCommand, type ClassifyCtx, type CommandFacts, type CommandRisk } from './classify.js';
import { escapesRoot, isProtectedPath } from './protected.js';

const none = (): CommandFacts => ({ writes: false, deletes: false, network: false, escapesRoot: false, isTest: false, destructive: false });
const mk = (risk: Risk, reason: string, facts: Partial<CommandFacts> = {}): CommandRisk => ({ risk, reasons: [reason], facts: { ...none(), ...facts }, autoAllowable: risk !== 'high' && !facts.destructive });
/** Risk of one normalised tool use. Paths are matched as strings, never read. */
export function classifyTool(t: { kind: ToolKind; paths?: string[]; mcpReadOnly?: boolean; command?: string }, ctx: ClassifyCtx): CommandRisk {
  try {
    const paths = t.paths ?? [];
    switch (t.kind) {
      case 'read': case 'search': { const cred = paths.some((p) => isProtectedPath(p, ctx, { write: false })); return cred ? mk('high', 'credential_read') : mk('low', 'read_only'); }
      case 'edit': case 'create': { const prot = paths.some((p) => isProtectedPath(p, ctx)); const out = paths.some((p) => escapesRoot(p, ctx)); if (prot) return mk('high', 'protected_path', { writes: true, escapesRoot: out }); if (out) return mk('high', 'writes_outside_root', { writes: true, escapesRoot: true }); return mk('medium', 'writes_in_root', { writes: true }); }
      case 'delete': return mk('high', 'deletes', { writes: true, deletes: true, destructive: true, escapesRoot: paths.some((p) => escapesRoot(p, ctx)) });
      case 'web': return mk('medium', 'network_fetch', { network: true });
      case 'mcp': return t.mcpReadOnly ? mk('low', 'mcp_read_only') : mk('medium', 'mcp_tool', { network: true });
      case 'command': return t.command === undefined ? mk('high', 'unparseable') : classifyCommand(t.command, ctx);
      default: return mk('medium', 'unknown_tool');
    }
  } catch { return mk('high', 'unparseable'); }
}

export interface RiskClassifierConfig extends ClassifyCtx { /** MCP servers marked read-only. */ readOnlyMcp?: ReadonlySet<string> }
export interface RiskClassifier { classify(req: ApprovalRequest): CommandRisk; hints(req: ApprovalRequest): { deletes: boolean; isTest: boolean } }
const mcpServer = (tool: string) => /^mcp__([^_]+(?:_[^_]+)*)__/.exec(tool)?.[1];
export function createRiskClassifier(cfg: RiskClassifierConfig): RiskClassifier {
  const classify = (req: ApprovalRequest): CommandRisk => {
    const ctx = { ...cfg, cwd: req.cwd ?? cfg.cwd };
    try {
      // by the tool's name only: the command-text guess in toolKind looks at the first segment, which is not enough for a risk decision
      const kind = req.command !== undefined ? 'command' : toolKind(req.tool); const srv = mcpServer(req.tool);
      const r = classifyTool({ kind, paths: req.path ? [req.path] : undefined, command: req.command, mcpReadOnly: !!srv && !!cfg.readOnlyMcp?.has(srv) }, ctx);
      // The request's own risk can only raise the result (a user rule acts later, in C015).
      if (req.risk === 'high' && r.risk !== 'high') return { ...r, risk: 'high', reasons: [...r.reasons, 'engine_reported_high'], autoAllowable: false };
      return r;
    } catch { return mk('high', 'unparseable'); }
  };
  return { classify, hints: (req) => { const r = classify(req); return { deletes: r.facts.deletes, isTest: r.facts.isTest }; } };
}
