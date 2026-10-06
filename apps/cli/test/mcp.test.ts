import { describe, expect, it } from 'vitest';
import { VirtualClock } from '@centcom/testkit';
import { createAgentBus, createMcpManager, type McpFs } from '@centcom/agent';
import { runMcp, type McpIO } from '../src/commands/mcp/index.js';

function io(files: Record<string, string> = {}, o: Partial<McpIO> & { yes?: boolean; sessions?: string[] } = {}) {
  const m = new Map(Object.entries(files)); const writes: string[] = []; const fs: McpFs = { read: async (p) => m.get(p), writeAtomic: async (p, t) => { writes.push(p); m.set(p, t); } };
  const out: string[] = []; const err: string[] = []; const asked: string[] = [];
  const mgr = createMcpManager({ fs, home: '/home/u', clock: new VirtualClock(), bus: createAgentBus({ onError: () => undefined }), which: (c) => (c === 'missing' ? undefined : `/bin/${c}`), engines: { testSession: async (_e, j) => { o.sessions?.push(j); const n = Object.keys(JSON.parse(j).mcpServers)[0]!; return { servers: [{ name: n, status: 'connected', tools: 2 }] }; } } });
  const base: McpIO = { mgr, root: '/proj', out: (l) => out.push(l), err: (l) => err.push(l), isTTY: true, confirm: async (q) => { asked.push(q); return o.yes ?? true; }, ...o };
  return { io: base, out, err, asked, m, writes };
}
describe('centcom mcp', () => {
  it('add shows the diff and the "runs a program" warning, asks, and writes the entry for both tools', async () => {
    const t = io(); expect(await runMcp(['add', 'files', '--cmd', 'npx', '--arg', '-y', '--arg', 'some-mcp'], t.io)).toBe(0); expect(t.out.join('\n')).toContain('runs a program on your machine'); expect(t.asked).toEqual(['Write this change?']);
    expect(JSON.parse(t.m.get('/proj/.mcp.json')!).mcpServers.files).toEqual({ type: 'stdio', command: 'npx', args: ['-y', 'some-mcp'] }); expect(t.m.get('/proj/.codex/config.toml')).toBe('[mcp_servers.files]\ncommand = "npx"\nargs = ["-y", "some-mcp"]\n');
  });
  it('references: only variable names are written; a token pasted where a variable name belongs is refused as a secret', async () => {
    const t = io(); await runMcp(['add', 'gh', '--cmd', 'gh-mcp', '--env-ref', 'GITHUB_TOKEN=GITHUB_TOKEN', '--engine', 'claude'], t.io); expect(t.m.get('/proj/.mcp.json')).toContain('${GITHUB_TOKEN}'); const bad = io(); expect(await runMcp(['add', 'gh', '--cmd', 'x', '--env-ref', 'TOKEN=ghp_' + 'a'.repeat(36), '--engine', 'claude', '--yes'], bad.io)).toBe(1); expect(bad.err.join(' ')).toContain('password or key'); expect(bad.err.join(' ')).not.toContain('ghp_'); expect(bad.writes).toEqual([]);
  });
  it('a no, or no terminal without --yes, writes nothing; user scope asks a second time', async () => {
    const no = io({}, { yes: false }); expect(await runMcp(['add', 'a', '--cmd', 'x'], no.io)).toBe(1); expect(no.writes).toEqual([]); const nt = io({}, { isTTY: false }); expect(await runMcp(['add', 'a', '--cmd', 'x'], nt.io)).toBe(1); expect(nt.err.join(' ')).toContain('--yes'); expect(nt.writes).toEqual([]);
    const u = io(); expect(await runMcp(['add', 'a', '--cmd', 'x', '--engine', 'codex', '--scope', 'user'], u.io)).toBe(0); expect(u.asked).toHaveLength(2); expect(u.writes).toEqual(['/home/u/.codex/config.toml']);
  });
  it('remove, the locked built-in, duplicates and usage errors', async () => {
    const t = io({ '/proj/.mcp.json': JSON.stringify({ mcpServers: { a: { command: 'a' }, b: { command: 'b' } } }, null, 2) + '\n' }); expect(await runMcp(['remove', 'a', '--engine', 'claude', '--yes'], t.io)).toBe(0); expect(Object.keys(JSON.parse(t.m.get('/proj/.mcp.json')!).mcpServers)).toEqual(['b']); expect([...t.m.keys()].some((k) => k.endsWith('.centcom-bak'))).toBe(true);
    const e = io(); expect(await runMcp(['remove', 'centcom-approvals', '--yes'], e.io)).toBe(1); expect(e.err.join(' ')).toContain('approvals'); expect(await runMcp(['add', 'b', '--cmd', 'x', '--engine', 'claude', '--yes'], t.io)).toBe(1); expect(await runMcp(['add'], e.io)).toBe(2); expect(await runMcp(['add', 'x'], e.io)).toBe(2); expect(await runMcp(['add', 'x', '--cmd', 'a', '--url', 'https://a.com'], e.io)).toBe(2); expect(await runMcp(['add', 'x', '--url', 'http://example.com', '--yes'], e.io)).toBe(2); expect(await runMcp(['list', '--scope', 'galaxy'], e.io)).toBe(2); expect(await runMcp(['x'], e.io)).toBe(2); expect(await runMcp([], e.io)).toBe(0);
  });
  it('list shows what is configured per tool, and the locked built-in; user scope for Claude explains itself', async () => {
    const t = io({ '/proj/.mcp.json': JSON.stringify({ mcpServers: { api: { type: 'http', url: 'https://x.example.com' } } }) }); await runMcp(['list'], t.io); expect(t.out).toContain('  centcom-approvals  built in (locked)'); expect(t.out).toContain('  api  http  https://x.example.com'); const u = io(); await runMcp(['list', '--scope', 'user'], u.io); expect(u.out.join('\n')).toContain('claude mcp add --scope user');
  });
  it('an invalid config file is refused with the position, untouched', async () => { const t = io({ '/proj/.mcp.json': '{ "mcpServers": }' }); expect(await runMcp(['add', 'a', '--cmd', 'x', '--engine', 'claude', '--yes'], t.io)).toBe(1); expect(t.err.join(' ')).toContain('line 1 column'); expect(t.writes).toEqual([]); });
  it('status says when nothing is reported; test runs one session for just that server, and a missing command fails without one', async () => {
    const t = io(); await runMcp(['status'], t.io); expect(t.out.join('\n')).toContain('not reported'); const sessions: string[] = []; const s = io({ '/proj/.mcp.json': JSON.stringify({ mcpServers: { files: { command: 'npx' }, gone: { command: 'missing' } } }) }, { sessions }); expect(await runMcp(['test', 'files'], s.io)).toBe(0); expect(sessions).toHaveLength(1); expect(Object.keys(JSON.parse(sessions[0]!).mcpServers)).toEqual(['files']); expect(s.out.at(-1)).toBe('files  connected  2 tools');
    expect(await runMcp(['test', 'gone'], s.io)).toBe(1); expect(sessions).toHaveLength(1); expect(s.out.at(-1)).toBe('gone  failed  command_not_found'); expect(await runMcp(['test', 'nope'], s.io)).toBe(1);
  });
});
