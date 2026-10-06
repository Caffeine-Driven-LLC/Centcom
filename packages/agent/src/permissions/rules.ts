import { createHash } from 'node:crypto';
import { toolKind } from '../state/mapping.js';
import type { ApprovalRequest, EngineId } from '../types.js';
import { globToRegExp } from './paths.js';
import { hasPrefix, readShell, splitWords } from './shell.js';
import type { PolicyMode, Rule, RuleAction } from './types.js';

export type ActionKind = 'read' | 'edit' | 'shell' | 'other';
/** What the tool does, for the mode defaults. Unknown tools are `other`, never `read`. */
export function actionKind(tool: string, _command?: string): ActionKind {
  // by tool name only: a shell tool is shell even when the command looks harmless (`ls`, `cat`); only a rule may allow it
  const k = toolKind(tool); if (k === 'read' || k === 'search') return 'read'; if (k === 'edit' || k === 'create' || k === 'delete') return 'edit'; if (k === 'command') return 'shell'; return 'other';
}
export const mcpServer = (tool: string): string | undefined => /^mcp__([^_].*?)__/.exec(tool)?.[1] ?? (/^mcp__([^_]+)$/.exec(tool)?.[1]);

/** Does a command pattern (Claude style) match this command? `git status:*` is a prefix on word boundaries, `git *` a wildcard, no star is exact. Allow rules only ever match a simple command. */
export function commandMatches(pattern: string, command: string, action: RuleAction): boolean {
  const info = readShell(command); const candidates = action === 'allow' ? (info.simple ? [command.trim()] : []) : [command.trim(), ...info.segments]; // deny and ask look at every part of a compound command
  return candidates.some((c) => {
    const w = splitWords(c); const p = pattern.trim();
    if (p.endsWith(':*')) return hasPrefix(w, splitWords(p.slice(0, -2)));
    if (p.includes('*')) return new RegExp('^' + p.split('*').map((x) => x.replace(/[.+^${}()|[\]\\?]/g, '\\$&')).join('.*') + '$').test(c.trim());
    return w.join(' ') === splitWords(p).join(' ');
  });
}
export function toolMatches(ruleTool: string, tool: string): boolean {
  if (ruleTool === '*') return true; const a = ruleTool.toLowerCase(), b = tool.toLowerCase(); if (a === b) return true;
  return a.endsWith('*') && b.startsWith(a.slice(0, -1));
}
export interface MatchInput { req: ApprovalRequest; engine?: EngineId; /** The request path relative to the agent root with forward slashes, or absolute if outside. */ relPath?: string }
export function ruleApplies(r: Rule, m: MatchInput): boolean {
  if (r.engine && r.engine !== '*' && m.engine && r.engine !== m.engine) return false; if (r.engine && r.engine !== '*' && !m.engine) return false;
  if (!toolMatches(r.tool, m.req.tool)) return false; const mt = r.matcher; if (!mt) return true;
  if (mt.command !== undefined && !(m.req.command !== undefined && commandMatches(mt.command, m.req.command, r.action))) return false;
  if (mt.path_glob !== undefined && !(m.relPath !== undefined && globToRegExp(mt.path_glob).test(m.relPath))) return false;
  if (mt.mcp_server !== undefined && mcpServer(m.req.tool) !== mt.mcp_server) return false; return true;
}
const specificity = (r: Rule) => (r.matcher?.command?.length ?? 0) + (r.matcher?.path_glob?.length ?? 0) + (r.matcher?.mcp_server ? 5 : 0) + (r.tool === '*' ? 0 : 1);
/** deny beats ask beats allow; inside one class the most specific rule is the one named. */
export function evaluateRules(rules: Rule[], m: MatchInput): { action: RuleAction; rule: Rule } | undefined {
  for (const action of ['deny', 'ask', 'allow'] as const) { const hit = rules.filter((r) => r.action === action && ruleApplies(r, m)).sort((a, b) => specificity(b) - specificity(a))[0]; if (hit) return { action, rule: hit }; }
  return undefined;
}

/* ------------------------------ Claude rule syntax ------------------------------ */
const PATH_TOOLS = new Set(['read', 'edit', 'write', 'multiedit', 'notebookedit', 'glob', 'grep', 'ls']);
const idOf = (s: string) => 'rul_' + createHash('sha256').update(s).digest('hex').slice(0, 20);
/** `Bash(git status:*)`, `Read(src/**)`, `Edit`, `mcp__server__tool`. The action and scope are not part of the text, so the result is an `allow` session rule. */
export function parseClaudeRule(s: string, action: RuleAction = 'allow'): Rule {
  const text = s.trim(); const m = /^([A-Za-z0-9_*.\-]+)(?:\((.*)\))?$/s.exec(text); if (!m) throw new SyntaxError('not a rule');
  const tool = m[1]!; const arg = m[2]; const base: Rule = { id: idOf(`${action}:${text}`), tool, action, scope: 'session', created_at: '' };
  if (arg === undefined || arg === '') return base;
  if (tool.toLowerCase() === 'bash') return { ...base, matcher: { command: arg } };
  if (PATH_TOOLS.has(tool.toLowerCase())) return { ...base, matcher: { path_glob: arg } };
  if (tool.startsWith('mcp__')) return { ...base, matcher: { mcp_server: arg } }; return { ...base, matcher: { command: arg } };
}
export function formatClaudeRule(r: Rule): string {
  const mt = r.matcher; if (!mt) return r.tool; const arg = mt.command ?? mt.path_glob ?? mt.mcp_server; return arg === undefined ? r.tool : `${r.tool}(${arg})`;
}
/** `--allowedTools` and `--disallowedTools` fragments, one argv entry per rule. `ask` rules have no flag form (asking is the CLI default). */
export function toClaudeArgs(rules: Rule[], _mode: PolicyMode = 'ask'): string[] {
  const out: string[] = []; const allow = rules.filter((r) => r.action === 'allow').map(formatClaudeRule); const deny = rules.filter((r) => r.action === 'deny').map(formatClaudeRule);
  if (allow.length) out.push('--allowedTools', ...allow); if (deny.length) out.push('--disallowedTools', ...deny); return out;
}
const CODEX_MODE: Record<PolicyMode, [string, string]> = { ask: ['workspace-write', 'untrusted'], 'accept-edits': ['workspace-write', 'on-request'], plan: ['read-only', 'untrusted'], 'auto-low-risk': ['workspace-write', 'on-request'], bypass: ['danger-full-access', 'never'] };
/** Codex only has a sandbox level and an approval policy. What a rule says beyond that cannot be sent to it; each such loss is listed (and Centcom's own broker still enforces the rule). */
export function toCodexArgs(rules: Rule[], mode: PolicyMode): { argv: string[]; translationNotes: string[] } {
  const [sandbox, ask] = CODEX_MODE[mode]; const notes: string[] = [];
  for (const r of rules) {
    const t = formatClaudeRule(r);
    if (r.action === 'deny') notes.push(`Codex cannot be given the deny rule ${t}; Centcom enforces it when Codex asks, but Codex may not ask.`);
    else if (r.matcher?.path_glob !== undefined) notes.push(`Codex cannot limit ${t} to certain paths; the sandbox level applies to the whole folder.`);
    else if (r.matcher?.command !== undefined) notes.push(`Codex cannot allow only part of the commands in ${t}; it asks according to its own policy.`);
    else if (r.matcher?.mcp_server !== undefined || r.tool.startsWith('mcp__')) notes.push(`Codex has no per-tool rules for ${t}.`);
  }
  if (mode === 'plan') notes.push('Plan mode is the read-only sandbox; Codex has no separate planning mode.');
  return { argv: ['--sandbox', sandbox, '--ask-for-approval', ask], translationNotes: notes };
}
