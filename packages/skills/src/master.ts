/** centcom-master: a text-only, pinned, scanned copy of a curated skill catalog, exposed as ONE router skill plus an index. */
import { execFile } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, extname, join } from 'node:path';
import { promisify } from 'node:util';
import { parseFrontmatter } from './index.js';

const run = promisify(execFile);
export const MASTER_DIR = join(homedir(), '.centcom', 'master');

export interface CatalogRow { skill: string; repo: string; flags: string[] }
export type Status = 'ok' | 'missing' | 'quarantined' | 'no-source' | 'clone-failed';
export interface Entry {
  id: string; skill: string; repo: string; flags: string[]; status: Status; enabled: boolean; why?: string;
  description: string; sha?: string; bytes?: number; findings: string[]; notes?: string[]; scriptsOmitted: number; path?: string;
}

/** Publishers whose skills are enabled by default; everyone else is off until you turn them on. */
const TRUSTED = new Set(['anthropics', 'vercel-labs', 'cloudflare', 'supabase', 'prisma', 'neondatabase', 'stripe', 'microsoft', 'trailofbits', 'mattpocock', 'obra', 'wshobson', 'pbakaus', 'shadcn', 'remotion-dev', 'emilkowalski', 'leonxlnx', 'nextlevelbuilder', 'planetscale']);

export function parseCatalog(tsv: string): CatalogRow[] {
  return tsv.split('\n').filter((l) => l.trim() && !l.startsWith('#')).map((l) => { const [skill, repo, flags = ''] = l.split('\t'); return { skill: skill!.trim(), repo: repo!.trim(), flags: flags.split(',').map((f) => f.trim()).filter(Boolean) }; });
}
export const idOf = (r: CatalogRow) => `${r.repo.split('/')[0]!.toLowerCase()}--${r.skill}`;

/** Default on/off with the reason, so the index can explain itself. */
export function defaultEnabled(r: CatalogRow): { on: boolean; why?: string } {
  const owner = r.repo.split('/')[0]!;
  const f = new Set(r.flags);
  if (f.has('nosrc')) return { on: false, why: 'no installable source' };
  if (f.has('ccx') || f.has('cc')) return { on: false, why: 'depends on Claude Code hooks/session files' };
  if (f.has('mcp')) return { on: false, why: 'needs an MCP server' };
  if (f.has('sub')) return { on: false, why: 'covered by the impeccable umbrella skill' };
  if (f.has('variant')) return { on: false, why: 'style variant; stacking conflicts with design-taste-frontend' };
  if (f.has('terse') || f.has('handoff') || f.has('budget')) return { on: false, why: 'overlaps with similar skills; pick one' };
  if (f.has('lowconf')) return { on: false, why: 'low-confidence listing' };
  if (!TRUSTED.has(owner)) return { on: false, why: 'publisher not on the trusted list' };
  return { on: true };
}

/* ------------------------------------------------------------------ scanning */
const SCRIPT_EXT = new Set(['.sh', '.bash', '.zsh', '.ps1', '.bat', '.cmd', '.py', '.pyc', '.js', '.mjs', '.cjs', '.ts', '.rb', '.pl', '.exe', '.dll', '.so', '.dylib', '.jar', '.zip', '.docx', '.xlsx', '.pptx', '.tar', '.gz', '.whl', '.bin', '.wasm']);
const TEXT_EXT = new Set(['.md', '.mdx', '.txt', '.json', '.yaml', '.yml', '.csv', '.toml', '.html', '.css', '.svg']);
/** `block` findings keep a skill out of auto-injection until a human reviews it; `note` findings are recorded only. */
const DEFENSIVE = /(data, not instructions|treat .{0,40}(inert|untrusted|as data)|flag (it|them|this)|prompt.injection|untrusted|suspicious|never follow|do not follow)/i;
export interface Scan { block: string[]; note: string[] }
export function scanText(text: string, file = 'SKILL.md'): Scan {
  const block: string[] = []; const note: string[] = [];
  const isSkill = /(^|\/)SKILL\.md$/.test(file);
  for (const line of text.split('\n')) {
    if (/(ignore|disregard) (all |any |the )?(previous|prior|above|system|developer)[^\n]{0,20}(instructions|rules|prompt|message)/i.test(line) && !DEFENSIVE.test(line)) block.push('tries to override earlier instructions');
    if (/base64\s+(-d|--decode)[^\n]*\|\s*(ba|z)?sh|base64\s+(-d|--decode)[^\n]*\|\s*eval/i.test(line)) block.push('decodes base64 straight into a shell');
    if (/(curl|wget)[^\n|]*\|\s*(sudo\s+)?(ba|z)?sh/i.test(line)) (isSkill ? block : note).push('pipes a download into a shell');
    if (/(send|post|upload|exfiltrat\w*)[^\n]{0,60}(\.env|ssh key|credentials|api[_ -]?key|token)/i.test(line)) note.push('mentions sending secrets');
    if (/\bcat\s+~?\/?\.?(ssh|aws|env)\b/i.test(line)) note.push('reads credential files');
  }
  if (/[\u{e0000}-\u{e007f}\u202a-\u202e\u2066-\u2069]/u.test(text)) block.push('hidden tag or bidirectional control characters');
  if ((text.match(/[\u200b\u200c\u2060\ufeff]/g) ?? []).length >= 3) block.push('many zero-width characters');
  return { block: [...new Set(block)], note: [...new Set(note)] };
}

function walkFiles(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) { if (n === '.git' || n === 'node_modules') continue; const p = join(dir, n); const st = statSync(p); if (st.isDirectory()) walkFiles(p, out); else out.push(p); }
  return out;
}

/** Copy only text files; count what was left out. Returns findings from scanning everything text. */
export function copyTextOnly(src: string, dst: string): { findings: string[]; notes: string[]; omitted: number; bytes: number } {
  const findings = new Set<string>(); const notes = new Set<string>(); let omitted = 0; let bytes = 0;
  for (const f of walkFiles(src)) {
    const rel = f.slice(src.length + 1); const ext = extname(f).toLowerCase(); const st = statSync(f);
    if (!TEXT_EXT.has(ext) || st.size > 400_000) { if (SCRIPT_EXT.has(ext) || st.size > 400_000) omitted++; continue; }
    const text = readFileSync(f, 'utf8'); const sc = scanText(text, rel); for (const w of sc.block) findings.add(`${rel}: ${w}`); for (const w of sc.note) notes.add(`${rel}: ${w}`);
    mkdirSync(dirname(join(dst, rel)), { recursive: true }); cpSync(f, join(dst, rel)); bytes += st.size;
  }
  return { findings: [...findings], notes: [...notes], omitted, bytes };
}

function findSkillDirs(root: string): { dir: string; name: string }[] {
  const hits: { dir: string; name: string }[] = [];
  const go = (d: string, depth: number) => {
    let names: string[]; try { names = readdirSync(d); } catch { return; }
    if (names.includes('SKILL.md')) { const fm = parseFrontmatter(readFileSync(join(d, 'SKILL.md'), 'utf8')); hits.push({ dir: d, name: fm.name || basename(d) }); }
    if (depth > 0) for (const n of names) { if (n === '.git' || n === 'node_modules') continue; const p = join(d, n); try { if (statSync(p).isDirectory()) go(p, depth - 1); } catch { /* skip */ } }
  };
  go(root, 6); return hits;
}

/* ------------------------------------------------------------------ build */
export interface SyncOptions { catalog: CatalogRow[]; out?: string; cache?: string; log?: (s: string) => void; concurrency?: number; only?: string[] }

async function cloneRepo(repo: string, cache: string): Promise<{ dir?: string; sha?: string; error?: string }> {
  const dir = join(cache, repo.replace('/', '__'));
  try {
    if (existsSync(join(dir, '.git'))) await run('git', ['-C', dir, 'pull', '--ff-only', '-q'], { timeout: 120_000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }).catch(() => undefined);
    else { mkdirSync(cache, { recursive: true }); await run('git', ['clone', '--depth', '1', '-q', `https://github.com/${repo}.git`, dir], { timeout: 180_000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_LFS_SKIP_SMUDGE: '1' } }); }
    const { stdout } = await run('git', ['-C', dir, 'rev-parse', 'HEAD']); return { dir, sha: stdout.trim() };
  } catch (e) { return { error: String((e as Error).message).split('\n')[0] }; }
}

export async function sync(o: SyncOptions): Promise<Entry[]> {
  const out = o.out ?? MASTER_DIR; const cache = o.cache ?? join(homedir(), '.centcom', 'skills-cache'); const log = o.log ?? (() => undefined);
  const rows = o.only ? o.catalog.filter((r) => o.only!.includes(r.repo)) : o.catalog;
  rmSync(join(out, 'skills'), { recursive: true, force: true }); mkdirSync(join(out, 'skills'), { recursive: true });
  const repos = [...new Set(rows.filter((r) => !r.flags.includes('nosrc')).map((r) => r.repo))];
  const cloned = new Map<string, Awaited<ReturnType<typeof cloneRepo>>>();
  let i = 0; const worker = async () => { while (i < repos.length) { const r = repos[i++]!; const res = await cloneRepo(r, cache); cloned.set(r, res); log(`${res.error ? '✗' : '✓'} ${r}${res.error ? '  ' + res.error : ''}`); } };
  await Promise.all(Array.from({ length: o.concurrency ?? 6 }, worker));

  const entries: Entry[] = [];
  for (const r of rows) {
    const id = idOf(r); const d = defaultEnabled(r);
    const base: Entry = { id, skill: r.skill, repo: r.repo, flags: r.flags, status: 'ok', enabled: d.on, why: d.why, description: '', findings: [], scriptsOmitted: 0 };
    if (r.flags.includes('nosrc')) { entries.push({ ...base, status: 'no-source', enabled: false }); continue; }
    const c = cloned.get(r.repo);
    if (!c?.dir) { entries.push({ ...base, status: 'clone-failed', enabled: false, why: c?.error }); continue; }
    const hits = findSkillDirs(c.dir); const lower = r.skill.toLowerCase();
    const hit = hits.filter((h) => h.name.toLowerCase() === lower || basename(h.dir).toLowerCase() === lower).sort((a, b) => a.dir.length - b.dir.length)[0];
    if (!hit) { entries.push({ ...base, status: 'missing', enabled: false, why: 'no SKILL.md with that name in the repo', sha: c.sha }); continue; }
    const dst = join(out, 'skills', id); const cp = copyTextOnly(hit.dir, dst);
    const fm = parseFrontmatter(readFileSync(join(dst, 'SKILL.md'), 'utf8'));
    const quarantined = cp.findings.length > 0;
    entries.push({ ...base, status: quarantined ? 'quarantined' : 'ok', enabled: quarantined ? false : base.enabled, why: quarantined ? 'scanner findings: review before enabling' : base.why, description: (fm.description ?? '').slice(0, 400), sha: c.sha, bytes: cp.bytes, findings: cp.findings, notes: cp.notes.slice(0, 12), scriptsOmitted: cp.omitted, path: join(dst, 'SKILL.md') });
  }
  writeIndex(out, entries); return entries;
}

export function loadEntries(out = MASTER_DIR): Entry[] { try { return JSON.parse(readFileSync(join(out, 'catalog.json'), 'utf8')) as Entry[]; } catch { return []; } }

export function writeIndex(out: string, entries: Entry[]) {
  writeFileSync(join(out, 'catalog.json'), JSON.stringify(entries, null, 1));
  const on = entries.filter((e) => e.enabled && e.status === 'ok');
  const lines = on.map((e) => `- ${e.id}: ${e.description.replace(/\s+/g, ' ').slice(0, 140)}`);
  writeFileSync(join(out, 'SKILL.md'), `---
name: centcom-master
description: Router for ${on.length} bundled design, backend, security and workflow skills. Use for any UI/frontend design, API/backend/database, testing, debugging, DevOps, security review, or code-review task, and consult the index to pick which bundled skill applies.
---

# Centcom master skill

This is an index, not a manual. Do not read the bundled skills in advance.

1. Scan the list in INDEX.md for the one to three skills that fit the task.
2. Read only those files: \`skills/<id>/SKILL.md\` (relative to this folder), plus any files they reference.
3. Follow them. If two bundled skills disagree, prefer the more specific one and tell the user.
4. Scripts from the original skills were deliberately left out. If a skill says to run one, do the equivalent by hand or ask the user.
`);
  writeFileSync(join(out, 'INDEX.md'), `# Bundled skills (${on.length} enabled)\n\n${lines.join('\n')}\n`);
  const off = entries.filter((e) => !e.enabled);
  writeFileSync(join(out, 'DISABLED.md'), `# Not enabled (${off.length})\n\n${off.map((e) => `- ${e.id} [${e.status}] ${e.why ?? ''}${e.findings.length ? '\n    ' + e.findings.join('\n    ') : ''}`).join('\n')}\n`);
}

/** Enabled, clean master entries as plain Skills so the matcher treats them like any other skill. */
export function masterSkills(out = MASTER_DIR): import('./index.js').Skill[] {
  return loadEntries(out).filter((e) => e.enabled && e.status === 'ok' && e.path).map((e) => ({ name: e.id, description: e.description, kind: 'skill' as const, source: 'master', path: e.path! }));
}

/** Turn one entry on or off by id (or unique fragment). Returns a message for the user. */
export function setEnabled(query: string, on: boolean, out = MASTER_DIR): string {
  const entries = loadEntries(out); const q = query.toLowerCase();
  const hit = entries.filter((e) => e.id.toLowerCase() === q || e.skill.toLowerCase() === q);
  const list = hit.length ? hit : entries.filter((e) => e.id.toLowerCase().includes(q));
  if (list.length === 0) return `No bundled skill matches "${query}".`;
  if (list.length > 1) return `"${query}" matches ${list.length}: ${list.slice(0, 6).map((e) => e.id).join(', ')}${list.length > 6 ? '…' : ''}. Use the full id.`;
  const e = list[0]!;
  if (e.status !== 'ok' && e.status !== 'quarantined') return `${e.id} is not available (${e.status}${e.why ? ': ' + e.why : ''}).`;
  if (on && e.status === 'quarantined') { e.status = 'ok'; e.why = 'enabled after manual review'; }
  e.enabled = on; writeIndex(out, entries);
  return `${e.id} ${on ? 'enabled' : 'disabled'}.`;
}
