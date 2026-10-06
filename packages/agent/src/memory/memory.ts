import { looksLikeSecret } from '@centcom/protocol';
import { isAbsolute, join, relative, resolve, basename } from 'node:path';
import type { EngineId } from '../types.js';
import { Conflict, MemoryError, PlanChanged, SecretRejected, TooLarge } from './errors.js';
import type { MemFs } from './fs.js';
import { detectEol, sha256, toLf, unifiedDiff, withEol } from './text.js';

export type MemEngine = Extract<EngineId, 'claude-code' | 'codex'>; export type MemScope = 'project' | 'user';
export interface MemTarget { engine: MemEngine | 'source'; scope: MemScope; path: string; /** sha256 of the file when the plan was made, null if it did not exist. */ baseSha: string | null; newText: string }
export interface MemoryPlan { kind: 'edit' | 'quick_add' | 'sync'; root?: string; targets: MemTarget[]; diff: string; planHash: string }
export interface ApplyReport { written: { engine: string; bytes: number }[] }
export type SyncState = 'in_sync' | 'source_changed' | 'target_edited' | 'conflict' | 'disabled';
export interface SyncStatus { state: SyncState; files: { engine: MemEngine; state: Exclude<SyncState, 'disabled'> }[] }
export interface MemoryDeps { fs: MemFs; engines: { memoryPaths(engine: EngineId, scope: MemScope, root?: string): string | undefined }; log?: { info(m: string, c?: Record<string, unknown>): void; warn(m: string, c?: Record<string, unknown>): void }; config: { sync: boolean } }
export const MAX_FILE = 256 * 1024; export const MAX_NOTE = 2048; export const NOTES_HEADING = '## Notes (added with Centcom)';
const BEGIN = /<!-- centcom:memory:begin sha256=([0-9a-f]{64}) -->/; const END = '<!-- centcom:memory:end -->'; const PEM = /-----BEGIN [A-Z ]*PRIVATE KEY-----/;
const ENGINES: MemEngine[] = ['claude-code', 'codex']; const SOURCE = ['.centcom', 'memory.md'];
const bytes = (s: string) => Buffer.byteLength(s, 'utf8'); const norm = (s: string) => toLf(s).replace(/\s+$/, '');

function guard(text: string, limit: number) { if (bytes(text) > limit) throw new TooLarge(limit); if (PEM.test(text) || looksLikeSecret(text)) throw new SecretRejected(); }
/** Adds one bullet under the Centcom notes heading (creating the heading), in the file's own line ending, touching nothing else. */
export function addNote(current: string, note: string): string {
  const eol = detectEol(current || '\n'); const bullet = '- ' + note.replace(/\s+/g, ' ').trim(); const m = /^## Notes \(added with Centcom\)[ \t]*\r?$/m.exec(current);
  if (m) { const from = m.index + m[0].length; const next = /^## /m.exec(current.slice(from)); const end = next ? from + next.index : current.length; const body = current.slice(from, end); const last = body.search(/\s*$/); const insertAt = from + last; const hasBullets = body.trim().length > 0; return current.slice(0, insertAt) + (hasBullets ? eol : eol + eol) + bullet + current.slice(insertAt); }
  const sep = current === '' ? '' : current.endsWith(eol + eol) ? '' : current.endsWith(eol) ? eol : eol + eol; return current + sep + NOTES_HEADING + eol + eol + bullet + eol;
}
export const buildRegion = (source: string, eol: '\r\n' | '\n') => { const body = norm(source); return `<!-- centcom:memory:begin sha256=${sha256(body)} -->${eol}${withEol(body, eol)}${eol}${END}`; };
export function findRegion(text: string): { start: number; end: number; markerSha: string; body: string } | undefined {
  const b = BEGIN.exec(text); if (!b) return undefined; const bodyStart = b.index + b[0].length; const e = text.indexOf(END, bodyStart); if (e < 0) return undefined; return { start: b.index, end: e + END.length, markerSha: b[1]!, body: text.slice(bodyStart, e).replace(/^\r?\n/, '').replace(/\r?\n$/, '') };
}
export function applyRegion(target: string, source: string): string {
  const eol = detectEol(target || '\n'); const region = buildRegion(source, eol); const f = findRegion(target); if (f) return target.slice(0, f.start) + region + target.slice(f.end);
  const sep = target === '' ? '' : target.endsWith(eol + eol) ? '' : target.endsWith(eol) ? eol : eol + eol; return target + sep + region + eol;
}
/** A composer line that starts with `# ` (hash and a space) is a memory note; `#hashtag` is an ordinary prompt. */
export const parseHashLine = (line: string): { kind: 'memory_add'; text: string } | { kind: 'prompt'; text: string } => { const m = /^#[ \t]+(\S[\s\S]*)$/.exec(line.trim()); return m ? { kind: 'memory_add', text: m[1]!.trim() } : { kind: 'prompt', text: line }; };

export interface MemoryFiles {
  read(engine: EngineId, scope: MemScope, root?: string): Promise<{ text: string; sha256: string; exists: boolean; unreadable?: boolean }>;
  plan(edit: { engine: EngineId | 'both'; scope: MemScope; newText?: string; quickAdd?: string; root?: string }): Promise<MemoryPlan>;
  apply(plan: MemoryPlan, confirm: { accepted: true; planHash: string }): Promise<ApplyReport>;
  status(root?: string): Promise<SyncStatus>; sync(op: { direction: 'source_to_targets' | 'target_to_source'; from?: EngineId; root?: string }): Promise<MemoryPlan>;
  importHint(root: string): Promise<{ existing: MemEngine; missing: MemEngine; offers: ('pointer' | 'copy')[] } | undefined>; planImport(root: string, kind: 'pointer' | 'copy'): Promise<MemoryPlan>;
}

export function createMemoryFiles(d: MemoryDeps): MemoryFiles {
  const pathFor = (engine: EngineId, scope: MemScope, root?: string): string => {
    if (scope === 'project' && !root) throw new MemoryError('unsafe_path', 'A project file needs a project folder.'); const p = d.engines.memoryPaths(engine, scope, root); if (!p) throw new MemoryError('no_path', 'That tool has no memory file there.');
    if (scope === 'project') { const rel = relative(resolve(root!), resolve(p)); if (rel.startsWith('..') || isAbsolute(rel)) throw new MemoryError('unsafe_path', 'The memory file has to be inside the project folder.'); } return p;
  };
  const sourcePath = (root: string) => join(root, ...SOURCE);
  async function load(path: string): Promise<{ text: string; sha: string | null; unreadable?: boolean }> {
    const r = await d.fs.read(path); if (!r) return { text: '', sha: null }; try { if (r.bytes.includes(0)) throw new Error('binary'); return { text: new TextDecoder('utf-8', { fatal: true }).decode(r.bytes), sha: sha256(r.bytes) }; } catch { return { text: '', sha: sha256(r.bytes), unreadable: true }; }
  }
  const mkPlan = (kind: MemoryPlan['kind'], targets: MemTarget[], current: Map<string, string>, root?: string): MemoryPlan => {
    const changed = targets.filter((t) => t.newText !== current.get(t.path)); const diff = changed.map((t) => unifiedDiff(current.get(t.path) ?? '', t.newText, `${t.engine}:${basename(t.path)}`)).join('\n');
    return { kind, targets: changed, diff, planHash: hashOf(changed), ...(root ? { root } : {}) };
  };
  const hashOf = (ts: MemTarget[]) => sha256(JSON.stringify(ts.map((t) => [t.path, t.baseSha, sha256(t.newText)])));
  const fileStates = async (root: string): Promise<{ engine: MemEngine; path: string; state: Exclude<SyncState, 'disabled'> }[]> => {
    const src = await load(sourcePath(root)); const srcSha = sha256(norm(src.text)); const out = [];
    for (const engine of ENGINES) { const path = pathFor(engine, 'project', root); const t = await load(path); const f = findRegion(t.text); let state: Exclude<SyncState, 'disabled'>;
      if (!f) state = 'source_changed'; else { const edited = sha256(norm(f.body)) !== f.markerSha; const changed = f.markerSha !== srcSha; state = edited && changed ? 'conflict' : edited ? 'target_edited' : changed ? 'source_changed' : 'in_sync'; } out.push({ engine, path, state }); }
    return out;
  };

  const self: MemoryFiles = {
    async read(engine, scope, root) { const l = await load(pathFor(engine, scope, root)); return { text: l.text, sha256: l.sha ?? sha256(''), exists: l.sha !== null, ...(l.unreadable ? { unreadable: true } : {}) }; },
    async plan(e) {
      const engines: MemEngine[] = e.engine === 'both' ? ENGINES : [e.engine as MemEngine]; const targets: MemTarget[] = []; const current = new Map<string, string>();
      if (e.quickAdd !== undefined) { if (bytes(e.quickAdd) > MAX_NOTE) throw new TooLarge(MAX_NOTE); guard(e.quickAdd, MAX_NOTE); } else if (e.newText !== undefined) guard(e.newText, MAX_FILE); else throw new MemoryError('no_path', 'Nothing to change.');
      for (const engine of engines) {
        const path = pathFor(engine, e.scope, e.root); const l = await load(path); if (l.unreadable) throw new MemoryError('unreadable', 'That file is not text, so it cannot be edited here.'); current.set(path, l.text);
        const next = e.quickAdd !== undefined ? addNote(l.text, e.quickAdd) : e.newText!; guard(next, MAX_FILE); targets.push({ engine, scope: e.scope, path, baseSha: l.sha, newText: next });
      }
      return mkPlan(e.quickAdd !== undefined ? 'quick_add' : 'edit', targets, current, e.root);
    },
    async status(root) {
      if (!d.config.sync || !root) return { state: 'disabled', files: [] }; if ((await load(sourcePath(root))).sha === null) return { state: 'disabled', files: [] };
      const files = (await fileStates(root)).map(({ engine, state }) => ({ engine, state })); const order = ['conflict', 'target_edited', 'source_changed', 'in_sync'] as const; return { state: order.find((s) => files.some((f) => f.state === s))!, files };
    },
    async sync(op) {
      if (!d.config.sync) throw new MemoryError('disabled', 'Memory sync is off for this project.'); if (!op.root) throw new MemoryError('unsafe_path', 'Sync needs a project folder.'); const root = op.root; const src = await load(sourcePath(root)); const current = new Map<string, string>(); const targets: MemTarget[] = [];
      if (op.direction === 'source_to_targets') {
        if (src.sha === null || src.unreadable) throw new MemoryError('no_path', 'There is no shared source file yet.'); guard(src.text, MAX_FILE);
        for (const engine of ENGINES) { const path = pathFor(engine, 'project', root); const t = await load(path); if (t.unreadable) throw new MemoryError('unreadable', 'A memory file is not text.'); current.set(path, t.text); const next = applyRegion(t.text, src.text); guard(next, MAX_FILE); targets.push({ engine, scope: 'project', path, baseSha: t.sha, newText: next }); }
      } else {
        if (!op.from || (op.from !== 'claude-code' && op.from !== 'codex')) throw new MemoryError('no_path', 'Say which file to pull from.'); const t = await load(pathFor(op.from, 'project', root)); const f = findRegion(t.text); if (!f) throw new MemoryError('no_path', 'That file has no Centcom section to pull.');
        const next = norm(f.body) + '\n'; guard(next, MAX_FILE); const path = sourcePath(root); current.set(path, src.text); targets.push({ engine: 'source', scope: 'project', path, baseSha: src.sha, newText: next });
      }
      return mkPlan('sync', targets, current, root);
    },
    async apply(plan, confirm) {
      if (!confirm || confirm.accepted !== true) throw new MemoryError('not_confirmed', 'Nothing was written: it needs a confirmation.'); if (confirm.planHash !== plan.planHash || hashOf(plan.targets) !== plan.planHash) throw new PlanChanged();
      const now = new Map<string, string>(); for (const t of plan.targets) { const l = await load(t.path); if (l.sha !== t.baseSha) throw new Conflict(l.text); now.set(t.path, l.text); }
      if (plan.kind !== 'sync' && d.config.sync && plan.root) { const states = await fileStates(plan.root).catch(() => []); for (const t of plan.targets) if (states.find((s) => s.path === t.path)?.state === 'conflict') throw new Conflict(now.get(t.path) ?? '', 'Both the shared source and this file changed; choose a direction with sync first.'); }
      const written: ApplyReport['written'] = []; for (const t of plan.targets) { const buf = Buffer.from(t.newText, 'utf8'); await d.fs.writeAtomic(t.path, buf, 0o644); written.push({ engine: t.engine, bytes: buf.length }); }
      d.log?.info('memory.applied', { files: written.length, kind: plan.kind }); return { written };
    },
    async importHint(root) { const have = await Promise.all(ENGINES.map(async (e) => ({ e, ok: (await load(pathFor(e, 'project', root))).sha !== null }))); if (have.every((h) => h.ok) || have.every((h) => !h.ok)) return undefined; const existing = have.find((h) => h.ok)!.e; return { existing, missing: ENGINES.find((x) => x !== existing)!, offers: ['pointer', 'copy'] }; },
    async planImport(root, kind) {
      const hint = await self.importHint(root); if (!hint) throw new MemoryError('no_path', 'Both files exist or neither does.'); const from = await load(pathFor(hint.existing, 'project', root)); const other = basename(pathFor(hint.existing, 'project', root));
      const text = kind === 'copy' ? from.text : `Project instructions are in ${other}. Read that file first.\n`; guard(text, MAX_FILE); const path = pathFor(hint.missing, 'project', root); return mkPlan('edit', [{ engine: hint.missing, scope: 'project', path, baseSha: null, newText: text }], new Map(), root);
    },
  };
  return self;
}
/** Where the two tools keep their memory files. The Codex user file is only an assumption until it is confirmed against the installed version. */
export const defaultMemoryPaths = (home: string) => ({ memoryPaths(engine: EngineId, scope: MemScope, root?: string): string | undefined {
  if (scope === 'project') return root ? join(root, engine === 'claude-code' ? 'CLAUDE.md' : engine === 'codex' ? 'AGENTS.md' : '') : undefined; if (engine === 'claude-code') return join(home, '.claude', 'CLAUDE.md'); if (engine === 'codex') return join(home, '.codex', 'AGENTS.md'); return undefined;
} });
