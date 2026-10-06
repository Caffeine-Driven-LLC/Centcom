import { join, resolve } from 'node:path';
import type { AgentBus, AgentId } from '../events/index.js';
import type { RunnerClock, RunnerLog } from '../runner/types.js';
import { BranchExists, DirtyWorktree, GitTimeout, GitTooOld, NotAGitRepo, WorktreeError } from './errors.js';
import type { GitResult, GitRunner } from './git.js';
import type { WtFs } from './fs.js';
import { isInside, isSystemDir, looksLikeOption, portable, slug } from './paths.js';

export interface Worktree { agentId: AgentId; path: string; branch: string; baseRef: string; repoRoot: string; /** Set by `list`: the folder was deleted by hand. */ missing?: boolean; /** Set by `list`: a worktree under the root that this manager did not create (never touched). */ orphan?: boolean }
export interface WorktreeStatus { branch: string; head: string; ahead: number; behind: number; dirty: boolean }
export interface WorktreeDeps { git: GitRunner; fs: WtFs; bus: AgentBus; clock: RunnerClock; log?: RunnerLog; config?: { root?: string }; random?: () => number; os?: 'posix' | 'win32' }
export interface WorktreeManager {
  create(o: { repoRoot: string; agentId: AgentId; ownerSlug: string; baseRef?: string; label?: string }): Promise<Worktree>;
  list(repoRoot: string): Promise<Worktree[]>; status(w: Worktree): Promise<WorktreeStatus>; remove(w: Worktree, o?: { force?: boolean }): Promise<void>;
  prune(repoRoot: string): Promise<number>; detectConflict(w: Worktree, otherRef: string): Promise<string[]>;
  /** Files changed on the worktree's branch since it left its base (names only, at most 200). */ changedFiles(w: Worktree): Promise<string[]>;
}
const T = { read: 10_000, write: 30_000, merge: 30_000 } as const; const MAX_BYTES = 4 * 1024 * 1024; const MAX_NAMES = 20;
interface Entry { path: string; branch: string; base_ref: string; created_at: string }
interface Registry { v: 1; entries: Record<string, Entry> }

export function createWorktreeManager(d: WorktreeDeps): WorktreeManager {
  const rnd = d.random ?? Math.random; const os = d.os ?? 'posix'; let gitOk = false;
  /** One git call, argv only. Enforces its own timeout on the injected clock, and retries when another git holds an index lock. */
  async function git(argv: string[], cwd: string, ms: number): Promise<GitResult> {
    for (let attempt = 0; ; attempt++) {
      let timer: unknown; const late = new Promise<'late'>((res) => { timer = d.clock.setTimeout(() => res('late'), ms); });
      const r = await Promise.race([d.git.run(argv, { cwd, timeoutMs: ms, maxBytes: MAX_BYTES }), late]); d.clock.clearTimeout(timer as never);
      if (r === 'late' || r.code === 124) throw new GitTimeout();
      if (r.code !== 0 && /index\.lock|\.lock': File exists/.test(r.stderr)) { if (attempt >= 3) throw new GitTimeout(); await new Promise<void>((res) => d.clock.setTimeout(res, 200 * (1 + rnd()))); continue; } // another git holds the lock: wait a little, three times, then give up
      return r;
    }
  }
  const ok = async (argv: string[], cwd: string, ms: number = T.read) => { const r = await git(argv, cwd, ms); if (r.code !== 0) throw new WorktreeError('git_failed', 'A git command failed.'); return r.stdout; };
  const reg = (repo: string) => join(repo, '.centcom', 'worktrees.json');
  async function load(repo: string): Promise<Registry> { const t = await d.fs.readFile(reg(repo)); if (!t) return { v: 1, entries: {} }; try { const j = JSON.parse(t) as Registry; return j?.v === 1 && j.entries && typeof j.entries === 'object' ? j : { v: 1, entries: {} }; } catch { return { v: 1, entries: {} }; } }
  const save = (repo: string, r: Registry) => d.fs.writeFileAtomic(reg(repo), JSON.stringify(r, null, 2) + '\n');
  const wt = (repo: string, id: string, e: Entry): Worktree => ({ agentId: id as AgentId, path: e.path, branch: e.branch, baseRef: e.base_ref, repoRoot: repo });

  async function repoTop(repoRoot: string): Promise<string> {
    if (looksLikeOption(repoRoot)) throw new NotAGitRepo();
    if (!gitOk) { const v = await git(['--version'], repoRoot, T.read).catch((e) => { if (e instanceof GitTimeout) throw e; return undefined; }); const m = v && /git version (\d+)\.(\d+)/.exec(v.stdout); if (!m) throw new NotAGitRepo(); if (Number(m[1]) < 2 || (Number(m[1]) === 2 && Number(m[2]) < 38)) throw new GitTooOld(); gitOk = true; }
    const bare = await git(['rev-parse', '--is-bare-repository'], repoRoot, T.read).catch((e) => { if (e instanceof GitTimeout) throw e; return undefined; }); if (!bare || bare.code !== 0 || bare.stdout.trim() === 'true') throw new NotAGitRepo();
    const top = await git(['rev-parse', '--show-toplevel'], repoRoot, T.read); if (top.code !== 0) throw new NotAGitRepo(); return d.fs.realpath(top.stdout.trim());
  }
  async function resolveRoot(repo: string): Promise<string> {
    const root = resolve(d.config?.root ?? join(repo, '.centcom', 'worktrees')); if (isSystemDir(root, os)) throw new WorktreeError('unsafe_root', 'That worktree folder is not allowed.');
    await d.fs.mkdirp(root); const real = await d.fs.realpath(root); if (isSystemDir(real, os) || !isInside(resolve(repo, '..'), real, os)) throw new WorktreeError('unsafe_root', 'The worktree folder has to be next to or inside the repository.'); return real;
  }
  async function checkRef(repo: string, ref: string): Promise<void> { if (looksLikeOption(ref)) throw new WorktreeError('bad_ref', 'That base is not a valid reference.'); const r = await git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], repo, T.read); if (r.code !== 0) throw new WorktreeError('bad_ref', 'That base is not a valid reference.'); }
  const branchExists = async (repo: string, b: string) => (await git(['show-ref', '--verify', '--quiet', `refs/heads/${b}`], repo, T.read)).code === 0;
  const validBranch = async (repo: string, b: string) => (await git(['check-ref-format', '--branch', b], repo, T.read)).code === 0;

  const m: WorktreeManager = {
    async create(o) {
      const repo = await repoTop(o.repoRoot); const root = await resolveRoot(repo); const r0 = await load(repo);
      if (r0.entries[o.agentId] && (await d.fs.exists(r0.entries[o.agentId]!.path))) throw new WorktreeError('duplicate_agent', 'That agent already has a worktree.');
      let base = o.baseRef; if (!base) { const cur = await git(['symbolic-ref', '--short', '-q', 'HEAD'], repo, T.read); base = cur.code === 0 && cur.stdout.trim() ? cur.stdout.trim() : 'HEAD'; } await checkRef(repo, base);
      const exclude = (await ok(['rev-parse', '--git-path', 'info/exclude'], repo)).trim(); const rel = portable(root).startsWith(portable(repo) + '/') ? '/' + portable(root).slice(portable(repo).length + 1) + '/' : undefined;
      await d.fs.appendLineOnce(resolve(repo, exclude), '/.centcom/*'); /* the contents, not the folder, so the shared project config can be re-included (centcom init) */ if (rel && !rel.startsWith('/.centcom/')) await d.fs.appendLineOnce(resolve(repo, exclude), rel);
      const owner = slug(o.ownerSlug, 'owner'); const agent = slug(o.label ?? o.agentId, 'agent', 56);
      for (let n = 1; n <= MAX_NAMES; n++) {
        const suffix = n === 1 ? '' : `-${n}`; const branch = `centcom/${owner}/${agent}${suffix}`; const path = join(root, `${owner}-${agent}${suffix}`);
        if (!(await validBranch(repo, branch)) || (await branchExists(repo, branch)) || (await d.fs.exists(path))) continue;
        const add = await git(['worktree', 'add', '-b', branch, '--', path, base], repo, T.write);
        if (add.code !== 0) { await d.git.run(['worktree', 'prune'], { cwd: repo, timeoutMs: T.read, maxBytes: MAX_BYTES }).catch(() => undefined); if (await d.fs.exists(path)) await d.fs.rmrf(path); if (await branchExists(repo, branch)) await git(['branch', '-D', '--', branch], repo, T.read); if (/already exists|is already checked out/.test(add.stderr)) continue; throw new WorktreeError('git_failed', 'Git could not create the worktree.'); }
        const entry: Entry = { path, branch, base_ref: base, created_at: new Date(d.clock.now()).toISOString() };
        try { const r = await load(repo); r.entries[o.agentId] = entry; await save(repo, r); }
        catch (e) { await git(['worktree', 'remove', '--force', '--', path], repo, T.write).catch(() => undefined); await git(['branch', '-D', '--', branch], repo, T.read).catch(() => undefined); throw e; } // roll back: nothing half-made stays behind
        d.bus.emit('worktree:created', { agent_id: o.agentId, path, branch }); d.log?.info('worktree.created', { agent_id: o.agentId }); return wt(repo, o.agentId, entry);
      }
      throw new BranchExists();
    },
    async list(repoRoot) {
      const repo = await repoTop(repoRoot); const r = await load(repo); const porcelain = await ok(['worktree', 'list', '--porcelain'], repo); const known = new Set(porcelain.split('\n').filter((l) => l.startsWith('worktree ')).map((l) => resolve(l.slice(9))));
      const out: Worktree[] = []; let changed = false;
      for (const [id, e] of Object.entries(r.entries)) { const exists = await d.fs.exists(e.path); const inGit = known.has(resolve(e.path)); if (!exists && !inGit) { delete r.entries[id]; changed = true; continue; } out.push({ ...wt(repo, id, e), ...(exists ? {} : { missing: true }) }); }
      if (changed) await save(repo, r);
      const root = resolve(d.config?.root ?? join(repo, '.centcom', 'worktrees')); const mine = new Set(out.map((w) => resolve(w.path)));
      for (const p of known) if (p !== resolve(repo) && isInside(root, p, os) && !mine.has(p)) out.push({ agentId: '' as AgentId, path: p, branch: '', baseRef: '', repoRoot: repo, orphan: true });
      return out;
    },
    async status(w) {
      const head = (await ok(['rev-parse', 'HEAD'], w.path)).trim(); const branch = (await ok(['rev-parse', '--abbrev-ref', 'HEAD'], w.path)).trim();
      const counts = (await ok(['rev-list', '--left-right', '--count', `${w.baseRef}...HEAD`], w.path)).trim().split(/\s+/).map(Number); const dirty = (await ok(['status', '--porcelain=v1', '-z'], w.path)).length > 0;
      return { branch, head, behind: counts[0] ?? 0, ahead: counts[1] ?? 0, dirty };
    },
    async remove(w, o = {}) {
      const repo = await repoTop(w.repoRoot); const r = await load(repo); const e = r.entries[w.agentId]; if (!e || resolve(e.path) !== resolve(w.path)) throw new WorktreeError('unknown_worktree', 'This worktree was not created by Centcom, so it is left alone.');
      const present = await d.fs.exists(e.path);
      if (present && !o.force) { const s = await m.status({ ...w, path: e.path, branch: e.branch, baseRef: e.base_ref }); if (s.dirty) throw new DirtyWorktree('uncommitted'); if (s.ahead > 0) throw new DirtyWorktree('unmerged'); }
      if (present) { const rm = await git(['worktree', 'remove', ...(o.force ? ['--force'] : []), '--', e.path], repo, T.write); if (rm.code !== 0) { if (!o.force) throw new DirtyWorktree('uncommitted'); await d.fs.rmrf(e.path); } }
      await git(['worktree', 'prune'], repo, T.read); if (await branchExists(repo, e.branch)) await git(['branch', o.force ? '-D' : '-d', '--', e.branch], repo, T.read);
      delete r.entries[w.agentId]; await save(repo, r); d.bus.emit('worktree:removed', { agent_id: w.agentId, path: e.path }); d.log?.info('worktree.removed', { agent_id: w.agentId });
    },
    async changedFiles(w) { const r = await git(['diff', '--name-only', '-z', `${w.baseRef}...HEAD`], w.path, T.read); return r.code === 0 ? r.stdout.split('\0').filter(Boolean).slice(0, 200) : []; },
    async prune(repoRoot) {
      const repo = await repoTop(repoRoot); const r = await load(repo); let n = 0; await git(['worktree', 'prune'], repo, T.read);
      for (const [id, e] of Object.entries(r.entries)) if (!(await d.fs.exists(e.path))) { delete r.entries[id]; n++; if (await branchExists(repo, e.branch)) await git(['branch', '-D', '--', e.branch], repo, T.read); }
      if (n) await save(repo, r); return n;
    },
    async detectConflict(w, otherRef) {
      await checkRef(w.repoRoot, otherRef); const r = await git(['merge-tree', '--write-tree', '--name-only', '-z', w.branch, otherRef], w.repoRoot, T.merge);
      if (r.code === 0) return []; if (r.code !== 1) throw new WorktreeError('git_failed', 'Git could not check for conflicts.');
      const parts = r.stdout.split('\0'); const names: string[] = []; for (const p of parts.slice(1)) { if (p === '') break; if (!names.includes(p)) names.push(p); } return names;
    },
  };
  return m;
}
export const branchUpdatePayload = async (m: WorktreeManager, w: Worktree) => ({ agent_id: w.agentId, ...(await m.status(w)) });
