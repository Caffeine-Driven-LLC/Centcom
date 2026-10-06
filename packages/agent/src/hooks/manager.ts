import { createHash } from 'node:crypto';
import { basename, dirname, join } from 'node:path';
import type { RunnerClock } from '../runner/types.js';
import type { Capability, EngineId } from '../types.js';
import { looksLikeSecretText } from '../mcp/defs.js';
import { unifiedDiff } from '../mcp/diff.js';
import { jsonErrorAt } from '../mcp/jsonpos.js';
import { CapabilityMissing, HooksError, HooksPlanChanged, SettingsInvalid } from './errors.js';
import { memberAt, scanObject, setMember, topAt } from './jsonpatch.js';
import { checkHook, CLAUDE_EVENTS, isKnownEvent, LIMITS } from './schema.js';
import { TEMPLATES, fillTemplate } from './templates.js';
import type { HooksApplyReport, HookDef, HookEntry, HookScope, HookTemplate, HooksList, HooksOp, HooksPlan, ReviewFlag, ValidationIssue } from './types.js';

export interface HooksFs { read(path: string): Promise<string | undefined>; writeAtomic(path: string, text: string): Promise<void>; /** File names in a folder (empty if there is none). */ list(dir: string): Promise<string[]>; remove(path: string): Promise<void> }
export interface HooksDeps {
  fs: HooksFs; clock: RunnerClock; log?: { info(m: string, c?: Record<string, unknown>): void };
  engines: { capabilities(engine: EngineId): ReadonlySet<Capability> | undefined; settingsPaths(engine: EngineId, scope: HookScope, root?: string): string | undefined };
  /** Looks a program up on PATH. Nothing is run. */ which?: (command: string) => string | undefined;
  /** What the user last confirmed for a shared file (a hash of its `hooks` text). */ confirmed?: { get(path: string): Promise<string | undefined>; set(path: string, hash: string): Promise<void> };
}
export interface HooksManager {
  list(root?: string): Promise<{ claude: HooksList; codex: HooksList }>; validate(def: HookDef, event?: string): ValidationIssue[]; templates(): HookTemplate[]; fromTemplate(id: string, choices?: Record<string, string>): { event: string; def: HookDef };
  plan(op: HooksOp): Promise<HooksPlan>; apply(plan: HooksPlan, confirm: { accepted: true; planHash: string; userScope?: true }): Promise<HooksApplyReport>; sessionSettingsArg(defs: (HookDef & { event: string })[]): string; markReviewed(path: string, root?: string): Promise<void>;
}
const MAX_BYTES = 1024 * 1024; const KEEP = 5; const sha = (s: string) => createHash('sha256').update(s).digest('hex'); const SCOPES: HookScope[] = ['project', 'local', 'user'];
type Hook = Record<string, unknown>; type Group = { matcher?: unknown; hooks?: unknown } & Record<string, unknown>;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** The hook commands of one event, in file order, with the group each one lives in. */
function flat(groups: unknown): { g: number; h: number; hook: Hook; matcher?: string }[] {
  const out: { g: number; h: number; hook: Hook; matcher?: string }[] = []; if (!Array.isArray(groups)) return out;
  groups.forEach((g, gi) => { if (!isObj(g) || !Array.isArray(g.hooks)) return; g.hooks.forEach((h, hi) => { if (isObj(h) && h.type === 'command' && typeof h.command === 'string') out.push({ g: gi, h: hi, hook: h, ...(typeof g.matcher === 'string' ? { matcher: g.matcher } : {}) }); }); });
  return out;
}
const toHook = (d: HookDef): Hook => ({ type: 'command', command: d.command, ...(d.timeout_s !== undefined ? { timeout: d.timeout_s } : {}) });
const defOf = (f: { hook: Hook; matcher?: string }): HookDef => ({ ...(f.matcher !== undefined ? { matcher: f.matcher } : {}), command: String(f.hook.command), ...(typeof f.hook.timeout === 'number' ? { timeout_s: f.hook.timeout } : {}) });
/** Words a shell understands itself: they are not programs on PATH. */
const SHELL_WORDS = new Set(['if', 'for', 'while', 'until', 'case', 'then', 'do', '{', '!', '[', '[[', 'echo', 'cd', 'exit', 'export', 'set', 'test', 'true', 'false', 'eval', 'exec', 'source', '.', 'read', 'printf', 'type', 'command', 'unset', 'wait', 'trap', 'ulimit', 'umask', ':']);
const firstWord = (c: string) => { const m = /^\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*([^\s|;&<>()]+)/.exec(c); return m?.[1]; };

export function createHooksManager(d: HooksDeps): HooksManager {
  const pathOf = (engine: EngineId, scope: HookScope, root?: string) => d.engines.settingsPaths(engine, scope, root);
  function parse(text: string, file: string): Record<string, unknown> {
    if (text.length > MAX_BYTES) throw new SettingsInvalid(file, 'too large'); let j: unknown; try { j = JSON.parse(text); } catch { throw new SettingsInvalid(file, jsonErrorAt(text)); }
    if (!isObj(j)) throw new SettingsInvalid(file); if (j.hooks !== undefined && !isObj(j.hooks)) throw new SettingsInvalid(file, 'hooks is not an object'); return j;
  }
  const secretCheck = (def: HookDef) => { if (looksLikeSecretText(def.command)) throw new HooksError('secret_rejected', 'That command contains something that looks like a password or key. Use an environment variable instead, so it never ends up in a settings file.'); };
  function issuesFor(def: HookDef, event: string, countAfter?: number): ValidationIssue[] {
    const out = checkHook(def); if (!isKnownEvent(event)) out.push({ code: 'unknown_event', message: `${event} is not one of the events Centcom knows; it is kept as it is.` });
    if (countAfter !== undefined && countAfter > LIMITS.hooksPerEvent) out.push({ code: 'too_many', message: `An event holds at most ${LIMITS.hooksPerEvent} hooks.` });
    const w = typeof def.command === 'string' ? firstWord(def.command) : undefined; if (d.which && w && !SHELL_WORDS.has(w) && !d.which(w)) out.push({ code: 'command_not_found', message: `"${w}" was not found on your PATH.` }); return out;
  }
  const hooksTextHash = (text: string): string => { const top = topAt(text); const m = top >= 0 ? memberAt(text, top, 'hooks') : undefined; return sha(m ? text.slice(m.valStart, m.valEnd) : ''); };

  async function listClaude(root?: string): Promise<HooksList> {
    const entries: HookEntry[] = []; let any = false;
    for (const scope of SCOPES) {
      const path = pathOf('claude-code', scope, root); if (!path) continue; any = true; const text = await d.fs.read(path); if (text === undefined) continue; const j = parse(text, basename(path));
      let review: ReviewFlag | undefined; if (scope === 'project' && d.confirmed && isObj(j.hooks) && Object.keys(j.hooks).length) { const was = await d.confirmed.get(path); review = was === undefined ? 'never_confirmed' : was !== hooksTextHash(text) ? 'changed_since_confirmed' : undefined; }
      for (const [event, groups] of Object.entries((j.hooks ?? {}) as Record<string, unknown>)) flat(groups).forEach((f, index) => { const def = defOf(f); entries.push({ engine: 'claude-code', scope, path, event, index, def, issues: issuesFor(def, event), ...(review ? { review } : {}) }); });
    }
    if (!any) return { supported: false, reason: 'No settings file location is known for Claude Code here.' };
    return { supported: true, entries, ...(d.engines.capabilities('claude-code') ? {} : { banner: 'unverified_version' as const }) };
  }
  async function build(op: HooksOp): Promise<{ plan: HooksPlan }> {
    if (op.engine !== 'claude-code') throw new CapabilityMissing('Editing hooks is only supported for Claude Code. The installed Codex does not document hook settings Centcom can edit.');
    const path = pathOf(op.engine, op.scope, op.root); if (!path) throw new CapabilityMissing('There is no settings file for that choice.');
    if (op.kind !== 'remove') { if (!op.def) throw new HooksError('invalid_hook', 'A hook definition is needed.'); if (!isKnownEvent(op.event)) throw new HooksError('invalid_hook', `Unknown event ${CLAUDE_EVENTS.length ? 'name' : ''}: only the documented events can be added to.`); secretCheck(op.def); }
    const text = await d.fs.read(path); const file = basename(path); const j = text === undefined ? {} : parse(text, file); const hooks = (j.hooks ?? {}) as Record<string, unknown>;
    const groups: Group[] = Array.isArray(hooks[op.event]) ? (structuredClone(hooks[op.event]) as Group[]) : []; if (hooks[op.event] !== undefined && !Array.isArray(hooks[op.event])) throw new SettingsInvalid(file, `${op.event} is not a list`);
    const cmds = flat(groups); const warnings: string[] = []; let issues: ValidationIssue[] = [];
    if (op.kind === 'add') {
      issues = issuesFor(op.def!, op.event, cmds.length + 1); groups.push({ ...(op.def!.matcher !== undefined ? { matcher: op.def!.matcher } : {}), hooks: [toHook(op.def!)] });
    } else {
      const f = cmds[op.index ?? -1]; if (!f) throw new HooksError('not_found', 'There is no hook at that position.');
      if (op.kind === 'update') {
        issues = issuesFor(op.def!, op.event, cmds.length); const g = groups[f.g]!; const same = (g.matcher as string | undefined) === op.def!.matcher; const nh = { ...f.hook, command: op.def!.command, ...(op.def!.timeout_s !== undefined ? { timeout: op.def!.timeout_s } : {}) }; if (op.def!.timeout_s === undefined) delete (nh as Hook).timeout;
        const arr = g.hooks as Hook[]; if (same || arr.length === 1) { arr[f.h] = nh; if (op.def!.matcher === undefined) delete g.matcher; else g.matcher = op.def!.matcher; } else { arr.splice(f.h, 1); groups.splice(f.g + 1, 0, { ...(op.def!.matcher !== undefined ? { matcher: op.def!.matcher } : {}), hooks: [nh] }); }
      } else { const g = groups[f.g]!; (g.hooks as Hook[]).splice(f.h, 1); if (!(g.hooks as Hook[]).length) groups.splice(f.g, 1); }
    }
    const blocking = issues.filter((i) => i.code !== 'command_not_found'); if (blocking.length) throw new HooksError(blocking[0]!.code === 'too_many' ? 'too_many' : 'invalid_hook', blocking[0]!.message, blocking[0]!.code);
    let next: string | undefined; const unit = groups.length ? groups : undefined; const value = unit; // an event with no hooks left is removed
    if (text === undefined) next = JSON.stringify({ hooks: value ? { [op.event]: value } : {} }, null, 2) + '\n';
    else {
      const top = topAt(text); const hm = memberAt(text, top, 'hooks');
      if (!hm) { if (!value) throw new HooksError('not_found', 'There is no hook at that position.'); next = setMember(text, top, 'hooks', { [op.event]: value }); }
      else { const t = setMember(text, hm.valStart, op.event, value); if (t === undefined) throw new SettingsInvalid(file); next = t; }
      if (next === undefined) throw new SettingsInvalid(file);
    }
    if (op.kind !== 'remove') warnings.push(`${file}: "${op.def!.command}" is run by ${op.scope === 'user' ? 'Claude Code in every project' : 'Claude Code'} every time the ${op.event} event fires. Centcom does not run it.`);
    // the file must still be valid, and every key other than hooks must be unchanged
    const after = parse(next, file); const { hooks: _a, ...restBefore } = j; const { hooks: _b, ...restAfter } = after; if (JSON.stringify(restBefore) !== JSON.stringify(restAfter)) throw new SettingsInvalid(file, 'internal check failed');
    const baseSha = text === undefined ? null : sha(text); const planHash = sha(JSON.stringify([path, baseSha, sha(next)]));
    return { plan: { path, scope: op.scope, engine: op.engine, baseSha, newText: next, diff: unifiedDiff(text ?? '', next, `${op.scope}:${file}`), planHash, warnings, issues } };
  }
  async function rotate(path: string): Promise<string[]> {
    const prefix = `${basename(path)}.centcom-bak.`; const names = (await d.fs.list(dirname(path))).filter((n) => n.startsWith(prefix)).sort().reverse(); const gone: string[] = [];
    for (const n of names.slice(KEEP)) { await d.fs.remove(join(dirname(path), n)); gone.push(n); } return gone;
  }
  return {
    list: async (root) => ({ claude: await listClaude(root), codex: { supported: false, reason: 'The installed Codex does not document hook settings that Centcom can edit, so there is nothing to show here.' } }),
    validate: (def, event) => (event === undefined ? checkHook(def) : issuesFor(def, event)), templates: () => TEMPLATES.map((t) => ({ ...t })),
    fromTemplate(id, choices) { const t = TEMPLATES.find((x) => x.id === id); if (!t) throw new HooksError('not_found', 'There is no such template.'); const def = fillTemplate(t, choices ?? {}); secretCheck(def); return { event: t.event, def }; },
    async plan(op) { return (await build(op)).plan; },
    async apply(plan, confirm) {
      if (!confirm || confirm.accepted !== true) throw new HooksError('not_confirmed', 'Nothing was written: it needs a confirmation.');
      if (confirm.planHash !== plan.planHash || sha(JSON.stringify([plan.path, plan.baseSha, sha(plan.newText)])) !== plan.planHash) throw new HooksPlanChanged();
      if (plan.scope === 'user' && confirm.userScope !== true) throw new HooksError('needs_user_confirm', 'This changes your user-level settings for every project; confirm that too.');
      const cur = await d.fs.read(plan.path); if ((cur === undefined ? null : sha(cur)) !== plan.baseSha) throw new HooksPlanChanged();
      let backup: string | undefined;
      try {
        if (cur !== undefined) { let ts = new Date(d.clock.now()).toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, '').replace('T', ''); let n = 1; let name = `${plan.path}.centcom-bak.${ts}`; while ((await d.fs.read(name)) !== undefined) name = `${plan.path}.centcom-bak.${ts}-${++n}`; backup = name; await d.fs.writeAtomic(backup, cur); }
        await d.fs.writeAtomic(plan.path, plan.newText);
      } catch { if (backup) await d.fs.remove(backup).catch(() => undefined); throw new HooksError('unwritable', 'The settings file could not be written, so nothing was changed.'); }
      const removedBackups = await rotate(plan.path); if (d.confirmed && plan.scope === 'project') await d.confirmed.set(plan.path, hooksTextHash(plan.newText)); d.log?.info('hooks.applied', { scope: plan.scope });
      return { path: plan.path, ...(backup ? { backup } : {}), removedBackups };
    },
    sessionSettingsArg(defs) {
      const hooks: Record<string, unknown[]> = {};
      for (const def of defs) { const issues = [...checkHook(def), ...(isKnownEvent(def.event) ? [] : [{ code: 'unknown_event' as const, message: '' }])]; if (issues.length) throw new HooksError('invalid_hook', 'A hook is not valid.', issues[0]!.code); secretCheck(def); (hooks[def.event] ??= []).push({ ...(def.matcher !== undefined ? { matcher: def.matcher } : {}), hooks: [toHook(def)] }); if (hooks[def.event]!.length > LIMITS.hooksPerEvent) throw new HooksError('too_many', 'An event holds at most 8 hooks.'); }
      return JSON.stringify({ hooks });
    },
    async markReviewed(path, root) { void root; const text = await d.fs.read(path); if (text !== undefined && d.confirmed) { parse(text, basename(path)); await d.confirmed.set(path, hooksTextHash(text)); } },
  };
}
void scanObject;
