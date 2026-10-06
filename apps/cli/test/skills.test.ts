import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runSkills } from '../src/commands/skills.js';

const rig = (answers: string[] = []) => { const out: string[] = []; const err: string[] = []; const cwd = mkdtempSync(join(tmpdir(), 'cc-sk-cli-')); const home = mkdtempSync(join(tmpdir(), 'cc-sk-home-')); return { out, err, cwd, home, io: { out: (l: string) => out.push(l), err: (l: string) => err.push(l), ask: async () => answers.shift() ?? '', cwd, home } }; };
describe('centcom skills', () => {
  it('status shows every skill not installed; install prints the diff first and writes nothing without a yes', async () => {
    const r = rig(['n']); expect(await runSkills(['status', '--engine', 'claude'], r.io)).toBe(0); expect(r.out.join('\n')).toContain('not_installed'); r.out.length = 0;
    expect(await runSkills(['install', '--engine', 'claude'], r.io)).toBe(1); expect(r.out.join('\n')).toContain('+++ '); expect(r.out.join('\n')).toContain('Nothing was written'); expect(existsSync(join(r.cwd, '.claude'))).toBe(false);
  });
  it('--yes still prints the diff, then installs; a second install has nothing to do; remove undoes it', async () => {
    const r = rig(); expect(await runSkills(['install', '--engine', 'claude', '--yes'], r.io)).toBe(0); expect(r.out.join('\n')).toContain('+++ '); expect(r.out.at(-1)).toMatch(/^Written 5/); expect(existsSync(join(r.cwd, '.claude', 'skills', 'code-review', 'SKILL.md'))).toBe(true);
    r.out.length = 0; expect(await runSkills(['install', '--engine', 'claude', '--yes'], r.io)).toBe(0); expect(r.out).toEqual(['Nothing to do.']); r.out.length = 0; expect(await runSkills(['remove', '--engine', 'claude', '--yes'], r.io)).toBe(0); expect(existsSync(join(r.cwd, '.claude', 'skills', 'code-review', 'SKILL.md'))).toBe(false);
  });
  it('codex adds one block to AGENTS.md and keeps your text; user scope asks a second time and writes under the home folder', async () => {
    const r = rig(['user folder']); writeFileSync(join(r.cwd, 'AGENTS.md'), 'my rules\n'); expect(await runSkills(['install', '--engine', 'codex', '--yes'], r.io)).toBe(0); const t = readFileSync(join(r.cwd, 'AGENTS.md'), 'utf8'); expect(t.startsWith('my rules\n')).toBe(true); expect(t).toContain('centcom:skills:begin');
    expect(await runSkills(['install', '--engine', 'claude', '--scope', 'user', '--yes'], r.io)).toBe(0); expect(existsSync(join(r.home, '.claude', 'skills', 'commit-message', 'SKILL.md'))).toBe(true); expect(existsSync(join(r.home, '.centcom', 'skills-installed.json'))).toBe(true);
    const no = rig(['nope']); expect(await runSkills(['install', '--engine', 'claude', '--scope', 'user', '--yes'], no.io)).toBe(1); expect(existsSync(join(no.home, '.claude'))).toBe(false);
  });
  it('bad usage is exit 2 with a hint', async () => { const r = rig(); expect(await runSkills([], r.io)).toBe(2); expect(await runSkills(['install', '--scope', 'galaxy'], r.io)).toBe(2); expect(await runSkills(['install', '--engine', 'gemini'], r.io)).toBe(2); expect(r.err.length).toBe(3); });
});
