/** Auto skills: find the user's installed skills and commands, then pick the ones that fit a prompt. Local and deterministic, no model call. */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';

export interface Skill { name: string; description: string; kind: 'skill' | 'command'; source: string; path: string }
export interface Pick { skill: Skill; score: number; why: string[] }

export function parseFrontmatter(text: string): Record<string, string> {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text); const out: Record<string, string> = {};
  if (!m) return out;
  let key = '';
  for (const line of m[1]!.split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (kv) { key = kv[1]!; out[key] = kv[2]!.replace(/^["'>|-]\s*|["']$/g, '').trim(); } else if (key && /^\s+\S/.test(line)) out[key] = (out[key] + ' ' + line.trim()).trim();
  }
  return out;
}

function walk(dir: string, depth: number, hit: (file: string) => void) {
  let names: string[]; try { names = readdirSync(dir); } catch { return; }
  for (const n of names) {
    if (n === 'node_modules' || n === '.git') continue;
    const p = join(dir, n);
    let st; try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) { if (depth > 0) walk(p, depth - 1, hit); } else hit(p);
  }
}

export function discover(opts: { cwd: string; home?: string }): Skill[] {
  const home = opts.home ?? homedir(); const found = new Map<string, Skill>();
  const add = (file: string, kind: Skill['kind'], source: string) => {
    let text: string; try { text = readFileSync(file, 'utf8'); } catch { return; }
    const fm = parseFrontmatter(text);
    const name = fm.name || (kind === 'skill' ? basename(dirname(file)) : basename(file, '.md'));
    const description = fm.description || (text.replace(/^---[\s\S]*?---/, '').trim().split('\n').find((l) => l.trim() && !l.startsWith('#')) ?? '');
    const key = kind + ':' + name; if (!found.has(key)) found.set(key, { name, description: description.slice(0, 600), kind, source, path: file });
  };
  const skillsIn = (root: string, source: string, depth: number) => walk(root, depth, (f) => { if (basename(f) === 'SKILL.md') add(f, 'skill', source); });
  const cmdsIn = (root: string, source: string) => walk(root, 2, (f) => { if (f.endsWith('.md')) add(f, 'command', source); });
  // project first so it wins over user-level duplicates
  skillsIn(join(opts.cwd, '.claude', 'skills'), 'project', 2); cmdsIn(join(opts.cwd, '.claude', 'commands'), 'project');
  skillsIn(join(home, '.claude', 'skills'), 'user', 2); cmdsIn(join(home, '.claude', 'commands'), 'user');
  skillsIn(join(home, '.claude', 'plugins', 'cache'), 'plugin', 6);
  return [...found.values()];
}

const STOP = new Set('a an the and or but of to in on at for with from by is are was were be been it this that these those i me my we our you your do does did can could should would will just please then set than so as if into out up about make want need get let add use using how what when where why which who not no yes new'.split(' '));
const stem = (w: string) => w.replace(/(ing|ed|es|s)$/, (m, _x, off) => (off >= 3 ? '' : m)).replace(/([^aeiou])\1$/, '$1');
const SYN: Record<string, string> = { fail: 'fail', failure: 'fail', failing: 'fail', failed: 'fail', broke: 'bug', broken: 'bug', crash: 'bug', crashes: 'bug', debug: 'bug', debugging: 'bug', bugs: 'bug', slow: 'perf', performance: 'perf', faster: 'perf', speed: 'perf', secure: 'security', vulnerability: 'security', vulnerabilities: 'security', ui: 'frontend', ux: 'frontend', css: 'frontend', layout: 'frontend' };
export function tokens(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/[\s-]+/).filter((w) => w.length > 2 && !STOP.has(w)).map((w) => SYN[w] ?? stem(w));
}

export interface MatchOptions { max?: number; minScore?: number }

/** Score each skill against the prompt with an IDF-weighted overlap; the skill's name and quoted trigger phrases count extra. */
export function match(prompt: string, skills: Skill[], opts: MatchOptions = {}): Pick[] {
  const max = opts.max ?? 3; const min = opts.minScore ?? 4;
  const q = tokens(prompt); if (q.length < 2) return [];
  const qset = new Set(q); const lower = prompt.toLowerCase();
  const docs = skills.map((s) => ({ s, name: new Set(tokens(s.name)), desc: new Set(tokens(s.description)) }));
  const df = new Map<string, number>(); for (const d of docs) for (const t of new Set([...d.name, ...d.desc])) df.set(t, (df.get(t) ?? 0) + 1);
  const idf = (t: string) => Math.log(1 + docs.length / (1 + (df.get(t) ?? 0)));
  const picks: Pick[] = [];
  for (const d of docs) {
    let score = 0; const why: string[] = []; let explicit = false;
    for (const t of qset) {
      if (d.name.has(t)) { score += 3 * idf(t); why.push(t); }
      else if (d.desc.has(t)) { score += idf(t); why.push(t); }
    }
    // quoted example phrases in the description, e.g. "find a skill for X"
    for (const m of d.s.description.matchAll(/"([^"]{6,80})"/g)) {
      const phrase = m[1]!.toLowerCase().replace(/\b(x|y)\b/g, '').replace(/[.…]+$/g, '').trim();
      if (phrase.length >= 6 && lower.includes(phrase)) { score += 6; explicit = true; why.push(`"${phrase}"`); }
    }
    if (lower.includes(d.s.name.toLowerCase()) && d.s.name.length > 3) { score += 8; explicit = true; why.push(d.s.name); }
    if (d.s.kind === 'command') score *= 0.7; // commands run things; only auto-pick them on strong evidence
    const uniq = [...new Set(why)];
    if (score >= min && (uniq.length >= 2 || explicit) && (explicit || uniq.length >= 3 || score >= min * 1.5)) picks.push({ skill: d.s, score, why: uniq.slice(0, 4) });
  }
  return picks.sort((a, b) => b.score - a.score).slice(0, max);
}

/** Text prepended to the prompt that goes to the engine. The transcript keeps the user's original words. */
export function injection(picks: Pick[]): string {
  if (!picks.length) return '';
  const lines = picks.map((p) => p.skill.source === 'master' ? `- Read ${p.skill.path} and follow it: ${p.skill.description.replace(/\s+/g, ' ').slice(0, 160)}` : p.skill.kind === 'skill' ? `- Use the "${p.skill.name}" skill (Skill tool): ${p.skill.description.slice(0, 160)}` : `- Follow the instructions of the /${p.skill.name} command: ${p.skill.description.slice(0, 160)}`);
  return `[Centcom auto skills: the user's tooling matched these to the request below. Apply them where they genuinely fit; ignore any that do not.]\n${lines.join('\n')}\n\n`;
}

export * from './master.js';
