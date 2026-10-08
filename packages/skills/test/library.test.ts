import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LIBRARY_DIR, injection, librarySkills, match, mergeLibrary, parseFrontmatter, type Skill } from '../src/index.js';

const NAMES = ['backend', 'code-review', 'database', 'design', 'frontend', 'marketing', 'security'];
const walk = (d: string): string[] => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
describe('the bundled skill library', () => {
  it('has the seven skills, each with a SKILL.md, references and the right front matter', () => {
    expect(readdirSync(LIBRARY_DIR).filter((n) => statSync(join(LIBRARY_DIR, n)).isDirectory()).sort()).toEqual(NAMES);
    for (const n of NAMES) {
      const text = readFileSync(join(LIBRARY_DIR, n, 'SKILL.md'), 'utf8'); const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)!; expect(m, n).toBeTruthy();
      const keys = [...m[1]!.matchAll(/^([a-z_-]+):/gm)].map((x) => x[1]); expect(keys, `${n}: only name and description`).toEqual(['name', 'description']);
      const fm = parseFrontmatter(text); expect(fm.name).toBe(n); expect((fm.description ?? '').length).toBeGreaterThan(200); expect(readdirSync(join(LIBRARY_DIR, n, 'references')).length, n).toBeGreaterThanOrEqual(8);
    }
  });
  it('every references/ path a SKILL.md names exists', () => {
    for (const n of NAMES) {
      const text = readFileSync(join(LIBRARY_DIR, n, 'SKILL.md'), 'utf8'); const refs = new Set([...text.matchAll(/`?((?<![\w/])(?:references|scripts)\/[A-Za-z0-9._/-]+\.(?:md|py))`?/g)].map((x) => x[1]!));
      for (const r of refs) expect(existsSync(join(LIBRARY_DIR, n, r)), `${n} names ${r}`).toBe(true);
    }
  });
  it('contains no executable code beyond the documented stdlib-only helper scripts, and no remote fetches in them', () => {
    const scripts = walk(LIBRARY_DIR).filter((f) => !f.endsWith('.md')); expect(scripts.map((f) => f.slice(LIBRARY_DIR.length + 1)).sort()).toEqual(['code-review/scripts/diff_stats.py', 'database/scripts/explain_summary.py', 'design/scripts/contrast.py', 'design/scripts/typescale.py', 'security/scripts/headers_check.py', 'security/scripts/secret_patterns.py']);
    for (const f of scripts) { const t = readFileSync(f, 'utf8'); expect(t, f).toMatch(/^#!\/usr\/bin\/env python3/); expect(t, f).not.toMatch(/^\s*(import|from)\s+(subprocess|requests|urllib3|numpy|pandas|pickle|socket|ctypes)\b/m); expect(t, f).not.toMatch(/\bos\.system\(|\beval\(\s*[a-z_]|\bpickle\.load/); }
  });
  it('loads as plain skills with the bundled source', () => {
    const s = librarySkills(); expect(s.map((x) => x.name).sort()).toEqual(NAMES); for (const k of s) { expect(k).toMatchObject({ kind: 'skill', source: 'bundled' }); expect(existsSync(k.path)).toBe(true); }
    expect(librarySkills(join(LIBRARY_DIR, 'nope'))).toEqual([]);
  });
  it('the matcher picks the right skill for typical requests', () => {
    const skills = librarySkills(); const top = (p: string) => match(p, skills, { max: 1 })[0]?.skill.name;
    expect(top('review this diff before I merge, any issues with this code?')).toBe('code-review');
    expect(top('my postgres query is slow, add an index and read the EXPLAIN plan')).toBe('database');
    expect(top('threat model this login flow and check for XSS and leaked secrets in the repo')).toBe('security');
    expect(top('make the landing page look better: typography, spacing, colour contrast')).toBe('design');
    expect(top('write the launch announcement and positioning copy for our developer tool')).toBe('marketing');
    expect(top('backend service: API design, auth tokens, background jobs, retries, caching and webhooks')).toBe('backend');
    expect(top('refactor this React component: state, data fetching and rendering performance')).toBe('frontend');
  });
  it('a pick tells the agent to read the file and only the references it needs', () => {
    const p = match('review this diff before I merge, any issues with this code?', librarySkills(), { max: 1 }); const text = injection(p); expect(text).toContain(`Read ${join(LIBRARY_DIR, 'code-review', 'SKILL.md')}`); expect(text).toContain('references/');
  });
  it('merge: the project wins, the library beats user-level skills of the same name, everything else stays', () => {
    const lib = librarySkills(); const mk = (name: string, source: string): Skill => ({ name, description: 'd', kind: 'skill', source, path: `/x/${source}/${name}` });
    const merged = mergeLibrary([mk('code-review', 'user'), mk('mine', 'user'), mk('design', 'project')], lib); const byName = (n: string) => merged.filter((s) => s.name === n);
    expect(byName('code-review').map((s) => s.source)).toEqual(['bundled']); expect(byName('design').map((s) => s.source)).toEqual(['project']); expect(byName('mine')).toHaveLength(1); expect(merged.filter((s) => s.source === 'bundled').map((s) => s.name).sort()).toEqual(NAMES.filter((n) => n !== 'design'));
  });
});
