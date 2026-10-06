import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { discover, injection, match, parseFrontmatter, type Skill } from '../src/index.js';

const S = (name: string, description: string, kind: Skill['kind'] = 'skill'): Skill => ({ name, description, kind, source: 'user', path: '/x/' + name });
const SKILLS = [
  S('test-driven-development', 'Use when implementing any feature or bugfix, before writing implementation code. Write the failing test first.'),
  S('systematic-debugging', 'Use when encountering any bug, test failure, or unexpected behavior, before proposing fixes'),
  S('brainstorming', 'You MUST use this before any creative work: creating features, building components, adding functionality.'),
  S('supabase', 'Use when doing anything with Supabase: database, auth, edge functions, migrations, row level security.'),
  S('find-skills', 'Helps users discover and install agent skills when they ask "find a skill for" something or "how do I do X".'),
  S('deploy', 'Ship the app to production', 'command'),
];
const names = (p: string) => match(p, SKILLS).map((x) => x.skill.name);

describe('auto skills', () => {
  it('parses frontmatter including folded values', () => {
    expect(parseFrontmatter('---\nname: a\ndescription: one\n  two\n---\nbody')).toEqual({ name: 'a', description: 'one two' });
    expect(parseFrontmatter('no frontmatter')).toEqual({});
  });
  it('matches by topic', () => {
    expect(names('the login test is failing with an unexpected error, fix this bug')[0]).toBe('systematic-debugging');
    expect(names('help me debug a failing test, there is a bug')[0]).toBe('systematic-debugging');
    expect(names('add row level security policies to my supabase tables')[0]).toBe('supabase');
    expect(names('find a skill for pdf editing')[0]).toBe('find-skills');
  });
  it('picks nothing for chit-chat and tiny prompts', () => {
    expect(names('thanks, looks good')).toEqual([]); expect(names('ok')).toEqual([]);
  });
  it('limits to three and builds an injection naming the skills', () => {
    const p = match('implement a new feature with a failing test first, fix the bug in supabase auth', SKILLS);
    expect(p.length).toBeLessThanOrEqual(3);
    const inj = injection(p); expect(inj).toContain('Centcom auto skills'); expect(inj.endsWith('\n\n')).toBe(true);
    expect(injection([])).toBe('');
  });
  it('discovers project and user skills and commands, project winning duplicates', () => {
    const root = mkdtempSync(join(tmpdir(), 'cc-')); const home = join(root, 'h'), cwd = join(root, 'p');
    mkdirSync(join(home, '.claude/skills/foo'), { recursive: true }); writeFileSync(join(home, '.claude/skills/foo/SKILL.md'), '---\nname: foo\ndescription: user foo\n---\n');
    mkdirSync(join(cwd, '.claude/skills/foo'), { recursive: true }); writeFileSync(join(cwd, '.claude/skills/foo/SKILL.md'), '---\nname: foo\ndescription: project foo\n---\n');
    mkdirSync(join(cwd, '.claude/commands'), { recursive: true }); writeFileSync(join(cwd, '.claude/commands/ship.md'), '---\ndescription: Ship it\n---\nrun deploy');
    const found = discover({ cwd, home });
    expect(found.find((s) => s.name === 'foo')?.description).toBe('project foo');
    expect(found.find((s) => s.name === 'ship')?.kind).toBe('command');
  });
});
