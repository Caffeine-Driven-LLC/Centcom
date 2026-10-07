/** Installs, updates and removes the skills pack as plain files the engines load themselves. Every change is planned, shown as a diff and needs a confirmation. Nothing is executed. */
import { join, dirname } from 'node:path';
import type { EngineId } from '../types.js';
import { UnsafePath, type SkillFs } from './fs.js';
import { NAME, loadPack, sha, type Pack } from './pack.js';

export type Scope = 'project' | 'user'; export type State = 'not_installed' | 'current' | 'outdated' | 'modified';
export interface Change { path: string; action: 'create' | 'update' | 'delete' | 'skip_modified'; before?: string; after?: string; /** For AGENTS.md: the file the block lives in. */ kind?: 'file' | 'block' }
export interface SkillsPlan { planHash: string; changes: Change[]; diff: string; op: { kind: 'install' | 'update' | 'remove'; engines: EngineId[]; scope: Scope; skills?: string[]; root?: string } }
export interface SkillsStatus { pack_version: string; per: { engine: EngineId; skill: string; state: State }[] }
export interface ApplyReport { written: string[]; deleted: string[]; skipped: string[] }
export class SkillsPlanChanged extends Error { readonly code = 'plan_changed'; constructor() { super('The confirmation does not match this plan, so nothing was written.'); this.name = 'PlanChanged'; } }
export class SkillsNotConfirmed extends Error { readonly code = 'not_confirmed'; constructor() { super('Nothing was written: it needs a confirmation.'); this.name = 'SkillsNotConfirmed'; } }
export interface InstallerDeps { fs: SkillFs; bundledDir: string; engines: { targetDirs(engine: EngineId, scope: Scope, root?: string): { skillsDir?: string; agentsMd?: string } }; /** Where the install record lives for a scope. */ recordPath(scope: Scope, root?: string): string; /** The folder writes must stay inside. */ boundary(scope: Scope, root?: string): string; log?: { debug(m: string): void } }
interface Record_ { pack_version: string; installed: Record<string, string> }
const BEGIN = (v: string, h: string) => `<!-- centcom:skills:begin v=${v} sha256=${h} -->`; const END = '<!-- centcom:skills:end -->';
const BLOCK = /<!-- centcom:skills:begin v=([^ ]+) sha256=([0-9a-f]{64}) -->\n([\s\S]*?)\n<!-- centcom:skills:end -->/;

export function blockBody(pack: Pack, names?: string[]): string { return pack.skills.filter((s) => !names || names.includes(s.name)).map((s) => { const body = s.text.replace(/^---\n[\s\S]*?\n---\n/, '').trim(); const desc = /^description:\s*(.+)$/m.exec(s.text)?.[1] ?? ''; return `## ${s.name}\n\n${desc}\n\n${body.replace(/^# .*\n+/, '')}`; }).join('\n\n'); }
const lines = (s?: string) => (s ?? '').split('\n');
function diffOf(c: Change): string { const head = c.action === 'create' ? `--- /dev/null\n+++ ${c.path}` : c.action === 'delete' ? `--- ${c.path}\n+++ /dev/null` : `--- ${c.path}\n+++ ${c.path}${c.action === 'skip_modified' ? '  (edited by you: left alone)' : ''}`; if (c.action === 'skip_modified') return head; return `${head}\n${lines(c.before).filter((l) => c.before !== undefined && !lines(c.after).includes(l)).map((l) => `-${l}`).join('\n')}${c.before !== undefined && c.after !== undefined ? '\n' : ''}${lines(c.after).filter((l) => c.after !== undefined && !lines(c.before).includes(l)).map((l) => `+${l}`).join('\n')}`.replace(/\n+$/, ''); }
const hashOf = (cs: Change[]) => sha(JSON.stringify(cs.map((c) => [c.path, c.action, c.after === undefined ? null : sha(c.after)])));

export function createSkillsInstaller(d: InstallerDeps) {
  const guard = async (scope: Scope, root: string | undefined, path: string) => d.fs.assertInside(d.boundary(scope, root), path);
  const safeName = (n: string) => { if (!NAME.test(n)) throw new UnsafePath(`"${n.slice(0, 30)}" is not a valid skill name.`); return n; };
  async function readRecord(scope: Scope, root?: string): Promise<Record_> { try { const j = JSON.parse((await d.fs.read(d.recordPath(scope, root))) ?? ''); return { pack_version: String(j.pack_version ?? ''), installed: typeof j.installed === 'object' && j.installed ? j.installed : {} }; } catch { return { pack_version: '', installed: {} }; } }
  async function stateOf(engine: EngineId, scope: Scope, pack: Pack, rec: Record_, root: string | undefined): Promise<{ skill: string; state: State; path: string; current?: string }[]> {
    const t = d.engines.targetDirs(engine, scope, root); const out: { skill: string; state: State; path: string; current?: string }[] = [];
    if (t.skillsDir) for (const s of pack.skills) { const path = join(t.skillsDir, safeName(s.name), 'SKILL.md'); const cur = await d.fs.read(path); const recd = rec.installed[path]; out.push({ skill: s.name, path, current: cur, state: cur === undefined ? 'not_installed' : sha(cur) === s.sha256 ? 'current' : recd && sha(cur) === recd ? 'outdated' : 'modified' }); }
    else if (t.agentsMd) { const text = await d.fs.read(t.agentsMd); const m = text ? BLOCK.exec(text) : null; const want = sha(blockBody(pack)); const recd = rec.installed[t.agentsMd]; for (const s of pack.skills) out.push({ skill: s.name, path: t.agentsMd, current: m?.[3], state: !m ? 'not_installed' : sha(m[3]!) === want ? 'current' : recd && sha(m[3]!) === recd ? 'outdated' : 'modified' }); }
    return out;
  }
  return {
    async status(scope: Scope, root?: string, engines: EngineId[] = ['claude-code', 'codex']): Promise<SkillsStatus> { const pack = await loadPack(d.fs, d.bundledDir); const rec = await readRecord(scope, root); const per: SkillsStatus['per'] = []; for (const e of engines) for (const s of await stateOf(e, scope, pack, rec, root)) per.push({ engine: e, skill: s.skill, state: s.state }); return { pack_version: pack.version, per }; },
    async plan(op: SkillsPlan['op']): Promise<SkillsPlan> {
      const pack = await loadPack(d.fs, d.bundledDir); const rec = await readRecord(op.scope, op.root); const changes: Change[] = []; const want = op.skills?.map(safeName);
      for (const e of op.engines) {
        const t = d.engines.targetDirs(e, op.scope, op.root);
        if (t.skillsDir) {
          for (const s of await stateOf(e, op.scope, pack, rec, op.root)) { if (want && !want.includes(s.skill)) continue; const sk = pack.skills.find((x) => x.name === s.skill)!; await guard(op.scope, op.root, s.path);
            if (op.kind === 'remove') { if (s.state === 'not_installed') continue; changes.push(s.state === 'modified' ? { path: s.path, action: 'skip_modified', before: s.current } : { path: s.path, action: 'delete', before: s.current }); }
            else { if (s.state === 'current') continue; if (s.state === 'modified') changes.push({ path: s.path, action: 'skip_modified', before: s.current, after: sk.text }); else changes.push({ path: s.path, action: s.state === 'not_installed' ? 'create' : 'update', before: s.current, after: sk.text }); } }
        } else if (t.agentsMd) {
          await guard(op.scope, op.root, t.agentsMd); const st = (await stateOf(e, op.scope, pack, rec, op.root))[0]; if (!st) continue; const body = blockBody(pack, want); const text = (await d.fs.read(t.agentsMd)) ?? '';
          if (op.kind === 'remove') { if (st.state === 'not_installed') continue; changes.push(st.state === 'modified' ? { path: t.agentsMd, action: 'skip_modified', kind: 'block', before: st.current } : { path: t.agentsMd, action: 'delete', kind: 'block', before: st.current }); }
          else { if (st.state === 'current' && !want) continue; const block = `${BEGIN(pack.version, sha(body))}\n${body}\n${END}`; const next = BLOCK.test(text) ? text.replace(BLOCK, () => block) : `${text}${text && !text.endsWith('\n') ? '\n' : ''}${text ? '\n' : ''}${block}\n`; if (next === text) continue; changes.push(st.state === 'modified' ? { path: t.agentsMd, action: 'skip_modified', kind: 'block', before: st.current, after: next } : { path: t.agentsMd, action: st.state === 'not_installed' ? 'create' : 'update', kind: 'block', before: text, after: next }); }
        }
      }
      return { planHash: hashOf(changes), changes, diff: changes.map(diffOf).join('\n\n'), op };
    },
    /** Writes exactly what the plan says, and only with a confirmation that matches it. `overwrite` names edited files the person agreed to replace or delete. */
    async apply(plan: SkillsPlan, confirm: { accepted: true; planHash: string; overwrite?: string[] }): Promise<ApplyReport> {
      if (!confirm || confirm.accepted !== true) throw new SkillsNotConfirmed(); if (confirm.planHash !== plan.planHash || hashOf(plan.changes) !== plan.planHash) throw new SkillsPlanChanged();
      const pack = await loadPack(d.fs, d.bundledDir); const rec = await readRecord(plan.op.scope, plan.op.root); const rep: ApplyReport = { written: [], deleted: [], skipped: [] };
      for (const c of plan.changes) await guard(plan.op.scope, plan.op.root, c.path); /* everything is checked before the first write */
      for (const c of plan.changes) {
        const ok = confirm.overwrite?.includes(c.path); const action = c.action === 'skip_modified' ? (ok ? (plan.op.kind === 'remove' ? 'delete' : 'update') : 'skip_modified') : c.action;
        if (action === 'skip_modified') { rep.skipped.push(c.path); continue; }
        if (c.kind === 'block') { const text = (await d.fs.read(c.path)) ?? ''; if (action === 'delete') { const next = text.replace(BLOCK, '').replace(/\n{3,}/g, '\n\n').replace(/^\n+/, ''); await d.fs.writeAtomic(c.path, next); delete rec.installed[c.path]; rep.deleted.push(c.path); } else { await d.fs.writeAtomic(c.path, c.after!); rec.installed[c.path] = sha(BLOCK.exec(c.after!)![3]!); rep.written.push(c.path); } }
        else if (action === 'delete') { await d.fs.remove(c.path); delete rec.installed[c.path]; rep.deleted.push(c.path); } else { await d.fs.writeAtomic(c.path, c.after!); rec.installed[c.path] = sha(c.after!); rep.written.push(c.path); }
      }
      await d.fs.writeAtomic(d.recordPath(plan.op.scope, plan.op.root), JSON.stringify({ pack_version: pack.version, installed: rec.installed }, null, 1) + '\n'); void dirname; return rep;
    },
  };
}
export type SkillsInstaller = ReturnType<typeof createSkillsInstaller>;
