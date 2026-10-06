import { describe, expect, it } from 'vitest';
import { classifyTool, createRiskClassifier, isProtectedPath, PROTECTED_PATHS } from '../../src/sandbox/index.js';
import { ctx } from './ctx.js';

describe('tool-level classification', () => {
  it('read and search are low, except credential places', () => { expect(classifyTool({ kind: 'read', paths: ['src/a.ts'] }, ctx).risk).toBe('low'); expect(classifyTool({ kind: 'search' }, ctx).risk).toBe('low'); expect(classifyTool({ kind: 'read', paths: ['~/.ssh/id_rsa'] }, ctx).risk).toBe('high'); expect(classifyTool({ kind: 'read', paths: ['.env.example'] }, ctx).risk).toBe('low'); });
  it('edit and create are medium inside the root and high outside or in protected places', () => { for (const kind of ['edit', 'create'] as const) { expect(classifyTool({ kind, paths: ['src/a.ts'] }, ctx).risk).toBe('medium'); expect(classifyTool({ kind, paths: ['/etc/x'] }, ctx).risk).toBe('high'); expect(classifyTool({ kind, paths: ['.git/config'] }, ctx).risk).toBe('high'); expect(classifyTool({ kind, paths: ['../x'] }, ctx).facts.escapesRoot).toBe(true); } });
  it('delete is high and destructive, web is medium, mcp is medium unless read-only', () => { const d = classifyTool({ kind: 'delete', paths: ['a'] }, ctx); expect(d.risk).toBe('high'); expect(d.autoAllowable).toBe(false); expect(classifyTool({ kind: 'web' }, ctx).risk).toBe('medium'); expect(classifyTool({ kind: 'mcp' }, ctx).risk).toBe('medium'); expect(classifyTool({ kind: 'mcp', mcpReadOnly: true }, ctx).risk).toBe('low'); });
  it('a command goes through the shell classifier', () => { expect(classifyTool({ kind: 'command', command: 'ls' }, ctx).risk).toBe('low'); expect(classifyTool({ kind: 'command' }, ctx).risk).toBe('high'); });
});
describe('protected paths', () => {
  it.each(['.git/config', '.env', '.env.local', '~/.ssh/id_rsa', '~/.aws/credentials', '~/.gnupg/x', '~/.claude/settings.json', '~/.codex/auth.json', '~/.bashrc', '~/.zshrc', '.centcom/state.json', '.github/workflows/ci.yml', '/etc/shadow'])('%s', (p) => { expect(isProtectedPath(p, ctx)).toBe(true); });
  it.each(['src/a.ts', 'README.md', '.github/CODEOWNERS', '.gitignore'])('%s is not', (p) => { expect(isProtectedPath(p, ctx)).toBe(false); });
  it('.env.example may be read but is still protected against writes (the contract says .env*)', () => { expect(isProtectedPath('.env.example', ctx, { write: false })).toBe(false); expect(isProtectedPath('.env.example', ctx)).toBe(true); });
  it('lists the places for the UI', () => { expect(PROTECTED_PATHS).toContain('.git/'); expect(PROTECTED_PATHS).toContain('.github/workflows/'); });
});
describe('risk classifier adapter', () => {
  const rc = createRiskClassifier({ ...ctx, readOnlyMcp: new Set(['docs']) });
  const req = (o: object) => ({ approval_id: 'a', agent_id: 'g', tool_id: 't', tool: 'Bash', summary: '', risk: 'low' as const, ...o });
  it('classifies a Bash request and hints for the state machine', () => { expect(rc.classify(req({ command: 'ls' })).risk).toBe('low'); expect(rc.classify(req({ command: 'rm -rf build' })).risk).toBe('medium'); expect(rc.hints(req({ command: 'rm a' }))).toEqual({ deletes: true, isTest: false }); expect(rc.hints(req({ command: 'pnpm test' }))).toEqual({ deletes: false, isTest: true }); });
  it('a chained command is judged as a whole, not by its first word', () => { expect(rc.classify(req({ command: 'cat a && rm -rf /' })).risk).toBe('high'); expect(rc.classify(req({ tool: 'Bash', command: 'ls | sh' })).risk).toBe('high'); });
  it('an engine-reported high risk is never lowered', () => { expect(rc.classify(req({ command: 'ls', risk: 'high' })).risk).toBe('high'); });
  it('mcp servers marked read-only are low', () => { expect(rc.classify(req({ tool: 'mcp__docs__search' })).risk).toBe('low'); expect(rc.classify(req({ tool: 'mcp__other__search' })).risk).toBe('medium'); });
  it('Write to an outside path is high', () => { expect(rc.classify(req({ tool: 'Write', path: '/etc/x' })).risk).toBe('high'); expect(rc.classify(req({ tool: 'Write', path: 'src/a.ts' })).risk).toBe('medium'); });
});
