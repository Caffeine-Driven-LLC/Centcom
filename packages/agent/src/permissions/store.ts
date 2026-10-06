import { createHash, randomBytes } from 'node:crypto';
import { join } from 'node:path';
import type { RunnerClock, TrustStore } from '../runner/types.js';
import type { AuditEvent, Rule, RuleAction, RuleScope } from './types.js';

import type { PermFs } from './fs.js';
export type { PermFs };
const ACTIONS = new Set<string>(['allow', 'deny', 'ask']); const SCOPES = new Set<string>(['session', 'project', 'user']); const ENGINES = new Set<string>(['claude-code', 'codex', 'fake', '*']);
const str = (v: unknown, max: number) => typeof v === 'string' && v.length > 0 && v.length <= max;
/** A rule file is accepted whole or not at all: one bad entry and the file is ignored (fail closed: zero allow rules from it). */
export function validateRules(j: unknown): Rule[] | undefined {
  const o = j as { v?: unknown; rules?: unknown }; if (!o || o.v !== 1 || !Array.isArray(o.rules) || o.rules.length > 5000) return undefined; const out: Rule[] = [];
  for (const r of o.rules as Record<string, any>[]) {
    if (!r || typeof r !== 'object' || !str(r.id, 80) || !str(r.tool, 200) || !ACTIONS.has(r.action) || !SCOPES.has(r.scope) || typeof r.created_at !== 'string') return undefined; if (r.engine !== undefined && !ENGINES.has(r.engine)) return undefined;
    if (r.matcher !== undefined) { const m = r.matcher; if (!m || typeof m !== 'object' || Object.keys(m).some((k) => !['command', 'path_glob', 'mcp_server'].includes(k) || !str(m[k], 500))) return undefined; }
    out.push({ id: r.id, tool: r.tool, action: r.action as RuleAction, scope: r.scope as RuleScope, created_at: r.created_at, ...(r.engine ? { engine: r.engine } : {}), ...(r.matcher ? { matcher: { ...r.matcher } } : {}) });
  }
  return out;
}
const sha = (t: string) => createHash('sha256').update(t).digest('hex');
export interface RuleStoreDeps { fs: PermFs; clock: RunnerClock; trust: TrustStore; userRulesPath: string; audit?: (e: AuditEvent) => void }
export interface RuleStore {
  list(root?: string): Rule[]; add(r: { tool: string; action: RuleAction; scope: RuleScope; engine?: Rule['engine']; matcher?: Rule['matcher'] }, root?: string): Promise<Rule>; remove(id: string): Promise<boolean>;
  loadUser(): Promise<void>; loadProject(root: string): Promise<{ loaded: boolean; needsTrust: boolean }>; trustProject(root: string): Promise<void>; needsTrust(): string[]; warnings(): string[];
}
export function createRuleStore(d: RuleStoreDeps): RuleStore {
  let user: Rule[] = []; const session: Rule[] = []; const project = new Map<string, Rule[]>(); const untrusted = new Set<string>(); const warns: string[] = [];
  const projectFile = (root: string) => join(root, '.centcom', 'permissions.local.json');
  const warn = (m: string) => { warns.push(m); d.audit?.({ type: 'rules_warning', reason: m }); };
  async function readRules(path: string, label: string): Promise<{ rules?: Rule[]; text?: string }> {
    let text: string | undefined; try { text = await d.fs.readFile(path); } catch { warn(`${label}: could not be read; ignored`); return {}; } if (text === undefined) return { rules: [], text: undefined };
    let j: unknown; try { j = JSON.parse(text); } catch { warn(`${label}: not valid JSON; ignored`); return {}; } const r = validateRules(j); if (!r) { warn(`${label}: not a valid rules file; ignored`); return {}; } return { rules: r, text };
  }
  async function save(path: string, rules: Rule[]): Promise<string> { const text = JSON.stringify({ v: 1, rules }, null, 2) + '\n'; await d.fs.writeFileAtomic(path, text); return text; } // the file system layer writes mode 0600
  const store: RuleStore = {
    list: (root) => [...user, ...(root ? project.get(root) ?? [] : []), ...session],
    async add(r, root) {
      const rule: Rule = { id: 'rul_' + randomBytes(8).toString('hex'), tool: r.tool, action: r.action, scope: r.scope, created_at: new Date(d.clock.now()).toISOString(), ...(r.engine ? { engine: r.engine } : {}), ...(r.matcher ? { matcher: r.matcher } : {}) };
      if (r.scope === 'session') { session.push(rule); return rule; }
      if (r.scope === 'user') { const next = [...user, rule]; await save(d.userRulesPath, next); user = next; return rule; }
      if (!root) throw new Error('a project rule needs a project folder'); const next = [...(project.get(root) ?? []), rule]; const text = await save(projectFile(root), next); project.set(root, next); untrusted.delete(root);
      await d.trust.trust('project-rules', sha(text), 'permissions.local.json (written by Centcom)'); await d.fs.appendLineOnce(join(root, '.git', 'info', 'exclude'), '/.centcom/').catch(() => undefined); return rule;
    },
    async remove(id) {
      const s = session.findIndex((x) => x.id === id); if (s >= 0) { session.splice(s, 1); return true; }
      if (user.some((x) => x.id === id)) { user = user.filter((x) => x.id !== id); await save(d.userRulesPath, user); return true; }
      for (const [root, rs] of project) if (rs.some((x) => x.id === id)) { const next = rs.filter((x) => x.id !== id); const text = await save(projectFile(root), next); project.set(root, next); await d.trust.trust('project-rules', sha(text), 'permissions.local.json (written by Centcom)'); return true; } return false;
    },
    async loadUser() { const r = await readRules(d.userRulesPath, 'user permissions'); user = r.rules ?? []; },
    async loadProject(root) {
      const r = await readRules(projectFile(root), 'project permissions'); if (!r.rules) { project.set(root, []); return { loaded: false, needsTrust: false }; } if (r.text === undefined) { project.set(root, []); return { loaded: true, needsTrust: false }; }
      if (!(await d.trust.isTrusted('project-rules', sha(r.text)).catch(() => false))) { project.set(root, []); untrusted.add(root); return { loaded: false, needsTrust: true }; } project.set(root, r.rules); untrusted.delete(root); return { loaded: true, needsTrust: false };
    },
    async trustProject(root) { const t = await d.fs.readFile(projectFile(root)); if (t === undefined) return; await d.trust.trust('project-rules', sha(t), 'permissions.local.json'); await store.loadProject(root); },
    needsTrust: () => [...untrusted], warnings: () => [...warns],
  };
  return store;
}
