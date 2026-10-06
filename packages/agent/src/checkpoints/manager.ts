import { randomBytes } from 'node:crypto';
import { dirname, isAbsolute, normalize, relative, resolve, sep } from 'node:path';
import { CheckpointError } from './errors.js';
import { nodeCheckpointFs } from './fs.js';
import type { Checkpoint, CheckpointDeps, CheckpointManager, EngineSessionRef, RewindMode, RewindPlan, RewindResult } from './types.js';

export const MAX_CHECKPOINTS = 100; const SUMMARY_BYTES = 8 * 1024; const TIMEOUT_MS = 30_000; const MAX_OUT = 64 * 1024 * 1024; const CHUNK = 100;
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
interface Entry extends Checkpoint { tree: string | null; endTree?: string; endCommit?: string }
const cut = (s: string, max: number) => { const b = Buffer.from(s, 'utf8'); if (b.length <= max) return s; let e = max; while (e > 0 && (b[e]! & 0xc0) === 0x80) e--; return b.subarray(0, e).toString('utf8'); };
const oneLine = (s: string, n: number) => Array.from(s.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim()).slice(0, n).join('');

export function createCheckpointManager(d: CheckpointDeps): CheckpointManager {
  const fs = d.fs ?? nodeCheckpointFs; const top = resolve(d.worktree); const ref = `refs/centcom/checkpoints/${d.agentId}`; const undoRef = `refs/centcom/rewind-undo/${d.agentId}`;
  let entries: Entry[] = []; let loaded: Promise<void> | undefined; let chain: Promise<unknown> = Promise.resolve(); let repo: boolean | undefined; let nextN = 1;
  const exclusive = <T>(f: () => Promise<T>): Promise<T> => { const run = chain.then(f, f); chain = run.catch(() => undefined); return run; };

  async function git(argv: string[], o: { env?: Record<string, string>; ok?: number[] } = {}): Promise<string> {
    const r = await d.git.run(argv, { cwd: top, timeoutMs: TIMEOUT_MS, maxBytes: MAX_OUT, env: o.env });
    if (r.code !== 0 && !(o.ok ?? []).includes(r.code)) throw new CheckpointError('git_failed', `git ${argv[0]} failed`); return r.stdout;
  }
  const ident = () => { const t = `${Math.floor(d.clock.now() / 1000)} +0000`; return { GIT_AUTHOR_NAME: 'Centcom', GIT_AUTHOR_EMAIL: 'centcom@localhost', GIT_COMMITTER_NAME: 'Centcom', GIT_COMMITTER_EMAIL: 'centcom@localhost', GIT_AUTHOR_DATE: t, GIT_COMMITTER_DATE: t }; };
  async function isRepo(): Promise<boolean> {
    if (repo !== undefined) return repo;
    try { const r = await d.git.run(['rev-parse', '--show-toplevel'], { cwd: top, timeoutMs: TIMEOUT_MS, maxBytes: MAX_OUT }); const t = r.code === 0 ? resolve(r.stdout.trim()) : ''; repo = t !== '' && (t === top || await sameDir(t, top)); } catch { repo = false; } return repo;
  }
  async function sameDir(a: string, b: string) { const { realpath } = await import('node:fs/promises'); try { return (await realpath(a)) === (await realpath(b)); } catch { return false; } }
  const gitPath = async (name: string) => resolve(top, (await git(['rev-parse', '--git-path', name])).trim());

  /** The whole working state as a git tree, built in a temporary index. HEAD, the real index, branches and stash are never touched. */
  async function snapshotTree(): Promise<string> {
    const tmp = await gitPath(`centcom-idx-${randomBytes(6).toString('hex')}`); const real = await gitPath('index');
    try {
      if (await fs.exists(real)) await fs.copyFile(real, tmp); const env = { GIT_INDEX_FILE: tmp };
      await git(['add', '-A', '--', '.'], { env }); return (await git(['write-tree'], { env })).trim();
    } finally { await fs.rm(tmp).catch(() => undefined); }
  }
  const treeOf = async (commit: string) => (await git(['rev-parse', `${commit}^{tree}`])).trim();
  async function headTree(): Promise<string> { const r = await d.git.run(['rev-parse', '--verify', '-q', 'HEAD^{tree}'], { cwd: top, timeoutMs: TIMEOUT_MS, maxBytes: MAX_OUT }); return r.code === 0 ? r.stdout.trim() : EMPTY_TREE; }
  async function diffPaths(a: string, b: string): Promise<{ status: string; path: string }[]> {
    const out = await git(['diff-tree', '--no-renames', '-r', '--name-status', '-z', a, b]); const parts = out.split('\0').filter((x) => x !== ''); const res: { status: string; path: string }[] = [];
    for (let i = 0; i + 1 < parts.length; i += 2) res.push({ status: parts[i]!.charAt(0), path: parts[i + 1]! }); return res;
  }
  const safeRel = (p: string): string => { const n = normalize(p); if (!p || isAbsolute(p) || p.includes('\0') || n === '..' || n.startsWith('..' + sep) || relative(top, resolve(top, n)).startsWith('..')) throw new CheckpointError('invalid_path', 'A path points outside the working folder, so nothing was changed.'); return n; };

  const meta = (c: { n: number; label: string; promptSeq: number; at: string; engineSession?: EngineSessionRef }) => [`centcom checkpoint ${c.n}`, '', `label: ${c.label}`, `prompt-seq: ${c.promptSeq}`, `at: ${c.at}`, ...(c.engineSession ? [`engine-session: ${c.engineSession.id}`, ...(c.engineSession.turnRef ? [`turn-ref: ${c.engineSession.turnRef}`] : [])] : [])].join('\n') + '\n';
  const parseMeta = (text: string, n: number, commit: string, tree: string): Entry => {
    const f = (k: string) => new RegExp(`^${k}: (.*)$`, 'm').exec(text)?.[1]; const sid = f('engine-session'); const tr = f('turn-ref');
    return { id: `ckp_${n}`, n, at: f('at') ?? '', label: f('label') ?? '', promptSeq: Number(f('prompt-seq') ?? 0) || 0, commit, tree, files: { changed: 0, added: 0, removed: 0 }, ...(sid ? { engineSession: { id: sid, ...(tr ? { turnRef: tr } : {}) } } : {}) };
  };
  async function load(): Promise<void> {
    if (!(await isRepo())) return;
    const lines = (await git(['for-each-ref', '--format=%(refname) %(objectname)', `${ref}@*`])).split('\n').filter(Boolean); const cps = new Map<number, Entry>(); const ends = new Map<number, string>();
    for (const l of lines) { const [name, sha] = l.split(' ') as [string, string]; const m = /@(\d+)(\.end)?$/.exec(name); if (m?.[2]) ends.set(Number(m[1]), sha); }
    for (const l of lines) { const [name, sha] = l.split(' ') as [string, string]; const m = /@(\d+)$/.exec(name); if (!m) continue; const n = Number(m[1]); const body = await git(['show', '-s', '--format=%B', sha]); cps.set(n, parseMeta(body, n, sha, await treeOf(sha))); }
    for (const [n, sha] of ends) { const e = cps.get(n); if (e) { e.endCommit = sha; e.endTree = await treeOf(sha); } }
    entries = [...cps.values()].sort((a, b) => a.n - b.n); nextN = (entries.at(-1)?.n ?? 0) + 1;
    let prev = await headTree(); for (const e of entries) { if (e.tree) { const ch = await diffPaths(prev, e.tree); e.files = { changed: ch.filter((x) => x.status === 'M').length, added: ch.filter((x) => x.status === 'A').length, removed: ch.filter((x) => x.status === 'D').length }; prev = e.tree; } }
  }
  const ready = () => (loaded ??= load().catch((e) => { loaded = undefined; throw e; }));
  const pub = (e: Entry): Checkpoint => ({ id: e.id, n: e.n, at: e.at, label: e.label, promptSeq: e.promptSeq, commit: e.commit, ...(e.engineSession ? { engineSession: e.engineSession } : {}), files: { ...e.files } });

  async function createLocked(label: string, ctx: { promptSeq: number; engineSession?: EngineSessionRef }, endNow = false): Promise<Entry> {
    await ready(); const n = nextN++; const at = new Date(d.clock.now()).toISOString(); const lbl = oneLine(label, 60); const base = { n, label: lbl, promptSeq: ctx.promptSeq, at, ...(ctx.engineSession ? { engineSession: ctx.engineSession } : {}) };
    const none: Entry = { id: `ckp_${n}`, ...base, commit: null, tree: null, files: { changed: 0, added: 0, removed: 0 } };
    if (!(await isRepo())) { entries.push(none); return none; }
    let e: Entry;
    try {
      const tree = await snapshotTree(); const prev = [...entries].reverse().find((x) => x.commit); const parent = prev?.commit;
      const commit = (await git(['-c', 'commit.gpgsign=false', 'commit-tree', tree, ...(parent ? ['-p', parent] : []), '-m', meta({ ...base })], { env: ident() })).trim();
      await git(['update-ref', `${ref}@${n}`, commit]); await git(['update-ref', ref, commit]);
      const ch = await diffPaths(prev?.tree ?? (await headTree()), tree);
      e = { id: `ckp_${n}`, ...base, commit, tree, files: { changed: ch.filter((x) => x.status === 'M').length, added: ch.filter((x) => x.status === 'A').length, removed: ch.filter((x) => x.status === 'D').length } };
    } catch { entries.push(none); return none; } // the turn still runs; this one has no file snapshot
    entries.push(e); if (endNow) await endLocked(e);
    while (entries.length > MAX_CHECKPOINTS) { const old = entries.shift()!; if (old.commit) { await git(['update-ref', '-d', `${ref}@${old.n}`], { ok: [1] }).catch(() => undefined); await git(['update-ref', '-d', `${ref}@${old.n}.end`], { ok: [1] }).catch(() => undefined); } }
    return e;
  }
  async function endLocked(e?: Entry): Promise<void> {
    await ready(); const last = e ?? entries.at(-1); if (!last?.commit || !(await isRepo())) return;
    try { const tree = await snapshotTree(); const commit = (await git(['-c', 'commit.gpgsign=false', 'commit-tree', tree, '-p', last.commit, '-m', `centcom checkpoint ${last.n} end\n`], { env: ident() })).trim(); await git(['update-ref', `${ref}@${last.n}.end`, commit]); last.endCommit = commit; last.endTree = tree; } catch { /* without an end marker, a later rewind simply asks about every file */ }
  }
  async function inProgress(): Promise<boolean> { for (const f of ['MERGE_HEAD', 'rebase-merge', 'rebase-apply', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'BISECT_LOG']) if (await fs.exists(await gitPath(f))) return true; return false; }
  const find = (id: string): Entry => { const e = entries.find((x) => x.id === id || String(x.n) === id); if (!e) throw new CheckpointError('not_found', 'There is no such checkpoint.'); return e; };
  const wantsFiles = (m: RewindMode) => m === 'files' || m === 'both'; const wantsConv = (m: RewindMode) => m === 'conversation' || m === 'both';
  const convMode = (e: Entry): 'engine-resume' | 'fresh-with-summary' => (d.engine.capabilities().has('resume') && e.engineSession?.id ? 'engine-resume' : 'fresh-with-summary');

  /** Who changed what since this checkpoint: the agent's turns are bracketed by end markers, so anything outside them was someone else. */
  async function outsideSet(k: Entry, now: string): Promise<{ set: Set<string>; unknown: boolean }> {
    const after = entries.filter((x) => x.n >= k.n && x.tree); const set = new Set<string>(); let unknown = false;
    for (let i = 0; i < after.length; i++) {
      const e = after[i]!; const next = after[i + 1];
      if (!e.endTree) { unknown = true; continue; }
      for (const c of await diffPaths(e.endTree, next ? next.tree! : now)) set.add(c.path);
    }
    return { set, unknown };
  }
  async function planLocked(id: string, mode: RewindMode): Promise<{ plan: RewindPlan; kinds: Map<string, 'restore' | 'delete'>; entry: Entry }> {
    await ready(); const e = find(id); const plan: RewindPlan = { restore: [], delete: [], skippedModifiedOutside: [], needsConfirm: false, conversation: wantsConv(mode) ? convMode(e) : 'none' }; const kinds = new Map<string, 'restore' | 'delete'>();
    if (!wantsFiles(mode)) return { plan, kinds, entry: e };
    if (!e.commit || !e.tree || !(await isRepo())) throw new CheckpointError('checkpoint_unavailable', 'There is no file snapshot for this point (the folder is not a git working folder, or the snapshot could not be made).');
    if (await inProgress()) throw new CheckpointError('operation_in_progress', 'A merge, rebase or similar is in progress in this folder. Finish or abort it first; files were not touched.');
    const now = await snapshotTree(); const { set, unknown } = await outsideSet(e, now);
    for (const c of await diffPaths(e.tree, now)) { const p = safeRel(c.path); const kind = c.status === 'A' ? 'delete' : 'restore'; if (unknown || set.has(c.path)) plan.skippedModifiedOutside.push(p); else plan[kind].push(p); kinds.set(p, kind); }
    plan.needsConfirm = plan.skippedModifiedOutside.length > 0; return { plan, kinds, entry: e };
  }
  async function restorePaths(tree: string, paths: string[]): Promise<void> {
    if (!paths.length) return; const tmp = await gitPath(`centcom-idx-${randomBytes(6).toString('hex')}`); const env = { GIT_INDEX_FILE: tmp };
    try { await git(['read-tree', tree], { env }); for (let i = 0; i < paths.length; i += CHUNK) await git(['checkout-index', '-f', '-q', '--', ...paths.slice(i, i + CHUNK)], { env }); } finally { await fs.rm(tmp).catch(() => undefined); }
  }
  async function removeCreated(p: string): Promise<void> {
    const abs = resolve(top, safeRel(p)); await fs.rm(abs); let dir = dirname(abs); while (dir !== top && dir.startsWith(top + sep)) { await fs.rmdirIfEmpty(dir); dir = dirname(dir); }
  }
  async function rewindLocked(id: string, mode: RewindMode, opts: { confirmedPaths?: string[] } = {}): Promise<RewindResult> {
    const { plan, kinds, entry } = await planLocked(id, mode); const confirmed = new Set((opts.confirmedPaths ?? []).map((p) => normalize(p)));
    const restore = [...plan.restore]; const del = [...plan.delete]; const skipped: string[] = [];
    for (const p of plan.skippedModifiedOutside) { if (confirmed.has(p)) (kinds.get(p) === 'delete' ? del : restore).push(p); else skipped.push(p); }
    const result: RewindResult = { restored: [], deleted: [], skipped };
    if (wantsFiles(mode) && (restore.length || del.length)) {
      const safety = await createLocked('before rewind', { promptSeq: entries.at(-1)?.promptSeq ?? entry.promptSeq }, true); if (safety.commit) { await git(['update-ref', undoRef, safety.commit]); result.undoRef = undoRef; }
      const done: string[] = [];
      try { await restorePaths(entry.tree!, restore); done.push(...restore); result.restored = restore; for (const p of del) { await removeCreated(p); result.deleted.push(p); done.push(p); } }
      catch { result.failed = { restored: done, unrestored: [...restore, ...del].filter((p) => !done.includes(p)) }; return result; }
      await endLocked();
    }
    if (wantsConv(mode)) {
      await d.store.markRewind(entry.promptSeq); const base = { agentId: d.agentId, cwd: top };
      if (plan.conversation === 'engine-resume') { try { result.conversation = { mode: 'engine-resume', session: await d.engine.start({ ...base, resume: { engine_session_id: entry.engineSession!.id } }) }; return result; } catch (err) { result.conversation = await fresh(entry, base, String((err as Error)?.message ?? err)); return result; } }
      result.conversation = await fresh(entry, base);
    }
    return result;
  }
  async function fresh(e: Entry, base: { agentId: string; cwd: string }, resumeError?: string) {
    const summary = cut(await d.store.summarize(e.promptSeq, SUMMARY_BYTES), SUMMARY_BYTES); const session = await d.engine.start(base);
    await session.send(`We are continuing an earlier conversation from a previous point. Summary of it so far:\n\n${summary}`);
    return { mode: 'fresh-with-summary' as const, session, ...(resumeError ? { resumeError } : {}) };
  }
  async function purgeLocked(): Promise<void> {
    if (!(await isRepo())) { entries = []; return; }
    const names = (await git(['for-each-ref', '--format=%(refname)', `${ref}`, `${ref}@*`, undoRef])).split('\n').filter(Boolean); for (const n of names) await git(['update-ref', '-d', n], { ok: [1] }); entries = []; nextN = 1;
  }
  return {
    ready, create: (label, ctx) => exclusive(async () => pub(await createLocked(label, ctx))), endTurn: () => exclusive(() => endLocked()), list: () => entries.map(pub),
    preview: (id, mode) => exclusive(async () => (await planLocked(id, mode)).plan), rewind: (id, mode, opts) => exclusive(() => rewindLocked(id, mode, opts)),
    purge: () => exclusive(purgeLocked), dispose: async () => { await chain.catch(() => undefined); },
  };
}
