import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { formatClaudeRule, parseClaudeRule, toClaudeArgs, toCodexArgs, type Rule } from '../../src/index.js';

const FIXTURES = ['Read', 'Edit', 'Write', 'MultiEdit', 'Glob', 'Grep', 'Bash', 'WebFetch', 'Bash(git status:*)', 'Bash(git *)', 'Bash(npm run build:*)', 'Bash(ls:*)', 'Bash(rm:*)', 'Bash(git push*)', 'Bash(docker compose up)', 'Bash(curl https://example.com/*)', 'Bash(pnpm test:*)', 'Bash(./scripts/check.sh)', 'Bash(echo "a b")', 'Bash(make:*)', 'Read(src/**)', 'Read(~/notes/*.md)', 'Edit(src/**/*.ts)', 'Edit(docs/*)', 'Write(/tmp/out.txt)', 'Edit(a b/c)', 'Glob(**/*.test.ts)', 'Grep(src/**)', 'MultiEdit(packages/*/src/**)', 'mcp__github__list_prs', 'mcp__github__*', 'mcp__slack', 'mcp__a_b__c_d', 'mcp__fs__read(server)', 'WebFetch(domain:example.com)', 'Task', 'TodoWrite', 'NotebookEdit(nb/**)', 'Bash(a:b:*)', 'Bash(sudo:*)', 'Bash(git commit -m *)', 'Bash(find . -name *.js)', 'Bash(*)', 'Bash(cat /etc/hosts)', 'Read(**)', 'Edit(.github/workflows/*)', 'Bash(npm i:*)', 'Bash(yarn:*)', 'Bash(cargo test:*)', 'Bash(go build ./...)'];
describe('Claude rule syntax', () => {
  it.each(FIXTURES)('round-trips %s', (s) => { const r = parseClaudeRule(s); expect(formatClaudeRule(r)).toBe(s); expect(formatClaudeRule(parseClaudeRule(formatClaudeRule(r)))).toBe(s); });
  it('has at least 50 fixtures', () => { expect(FIXTURES.length).toBeGreaterThanOrEqual(50); });
  it('puts the argument where it belongs: command for Bash, path for file tools, server for mcp', () => { expect(parseClaudeRule('Bash(git status:*)').matcher).toEqual({ command: 'git status:*' }); expect(parseClaudeRule('Read(src/**)').matcher).toEqual({ path_glob: 'src/**' }); expect(parseClaudeRule('Edit').matcher).toBeUndefined(); expect(parseClaudeRule('Bash(rm:*)', 'deny').action).toBe('deny'); });
  it('text that is not a rule is a SyntaxError, and arbitrary text never does anything else', () => { for (const s of ['', '(x)', 'Bash(', 'a b', 'Bash(x))extra']) expect(() => parseClaudeRule(s), s).toThrow(SyntaxError); fc.assert(fc.property(fc.string({ maxLength: 200 }), (s) => { try { const r = parseClaudeRule(s); expect(typeof formatClaudeRule(r)).toBe('string'); } catch (e) { expect(e).toBeInstanceOf(SyntaxError); } }), { numRuns: 500 }); });
});
const R = (a: Rule['action'], s: string): Rule => parseClaudeRule(s, a);
describe('argument translation', () => {
  it('Claude: allow and deny become separate flags with one entry per rule; ask has no flag', () => {
    expect(toClaudeArgs([R('allow', 'Read'), R('allow', 'Bash(git status:*)'), R('deny', 'Bash(rm:*)')], 'ask')).toEqual(['--allowedTools', 'Read', 'Bash(git status:*)', '--disallowedTools', 'Bash(rm:*)']); expect(toClaudeArgs([], 'ask')).toEqual([]); expect(toClaudeArgs([R('ask', 'Bash(npm publish*)')], 'ask')).toEqual([]);
  });
  it('Codex: every mode maps to a sandbox and an approval policy', () => {
    expect(toCodexArgs([], 'plan').argv).toEqual(['--sandbox', 'read-only', '--ask-for-approval', 'untrusted']); expect(toCodexArgs([], 'ask').argv).toEqual(['--sandbox', 'workspace-write', '--ask-for-approval', 'untrusted']); expect(toCodexArgs([], 'accept-edits').argv).toEqual(['--sandbox', 'workspace-write', '--ask-for-approval', 'on-request']); expect(toCodexArgs([], 'bypass').argv).toEqual(['--sandbox', 'danger-full-access', '--ask-for-approval', 'never']);
  });
  it('Codex: what cannot be expressed is reported, never silently widened', () => {
    const t = toCodexArgs([R('allow', 'Edit(src/**)'), R('deny', 'Bash(rm:*)'), R('allow', 'Bash(git status:*)'), R('allow', 'mcp__github__list')], 'plan'); expect(t.translationNotes.length).toBeGreaterThanOrEqual(4); expect(t.translationNotes.join(' ')).toContain('Edit(src/**)'); expect(t.translationNotes.join(' ')).toContain('deny rule Bash(rm:*)'); expect(t.argv).not.toContain('danger-full-access');
    expect(toCodexArgs([R('allow', 'Read')], 'ask').translationNotes).toEqual([]);
  });
});
