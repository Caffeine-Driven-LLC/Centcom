import { describe, expect, it } from 'vitest';
import { BuiltinServer, InvalidConfig, McpError, McpPlanChanged, claudeConfigArg, parseServers, setServerTable, splitLines, toClaude, toCodex, printTable } from '../../src/index.js';
import { FILES, ok, rig } from './helpers.js';

const MCP = '/proj/.mcp.json'; const TOML = '/home/u/.codex/config.toml';
const ORIGINAL_JSON = '{\n  "zeta": 1,\n  "mcpServers": {\n    "b": { "command": "b" },\n    "a": { "type": "http", "url": "https://a.example.com" }\n  },\n  "alpha": [1, 2]\n}\n';
const CODEX_TOML = '# my codex config\nmodel = "gpt-5"\n\n[projects."/work"]\ntrust_level = "trusted"\n\n[mcp_servers.old]\ncommand = "old-cmd"\nargs = ["x"]\n\n[mcp_servers.old.env]\nLEVEL = "debug"\n\n[tui]\nnotifications = true\n';

describe('Claude .mcp.json', () => {
  it('add writes one mcpServers.files entry and a backup of the previous bytes; unrelated keys and order are kept', async () => {
    const r = rig({ files: { [MCP]: ORIGINAL_JSON } }); const plan = await r.mgr.plan({ kind: 'add', engine: 'claude-code', scope: 'project', def: FILES, root: r.root });
    expect(plan.diff).toContain('+    "files"'); expect(plan.warnings.join(' ')).toContain('runs a program on your machine'); await r.mgr.apply(plan, ok(plan)); const j = JSON.parse(r.f.m.get(MCP)!); expect(Object.keys(j)).toEqual(['zeta', 'mcpServers', 'alpha']); expect(Object.keys(j.mcpServers)).toEqual(['b', 'a', 'files']); expect(j.mcpServers.files).toEqual({ type: 'stdio', command: 'npx', args: ['-y', 'some-mcp'] }); expect(j.alpha).toEqual([1, 2]);
    const bak = [...r.f.m.keys()].filter((k) => k.endsWith('.centcom-bak')); expect(bak).toHaveLength(1); expect(r.f.m.get(bak[0]!)).toBe(ORIGINAL_JSON); expect(bak[0]).toMatch(/\.mcp\.json\.\d{8}T\d{6}Z\.centcom-bak$/); expect(r.f.m.get(MCP)!.startsWith('{\n  "zeta": 1,\n  "mcpServers": {')).toBe(true);
  });
  it('keeps a four-space or tab indent and a missing final newline; a missing file is created with 2 spaces', async () => {
    const r = rig({ files: { [MCP]: '{\n    "mcpServers": {}\n}' } }); const p = await r.mgr.plan({ kind: 'add', engine: 'claude-code', scope: 'project', def: FILES, root: r.root }); expect(p.targets[0]!.newText).toMatch(/^\{\n    "mcpServers": \{\n        "files"/); expect(p.targets[0]!.newText.endsWith('\n')).toBe(false);
    const n = rig(); const q = await n.mgr.plan({ kind: 'add', engine: 'claude-code', scope: 'project', def: FILES, root: n.root }); expect(q.targets[0]!.baseSha).toBeNull(); expect(q.targets[0]!.newText).toBe(JSON.stringify({ mcpServers: { files: { type: 'stdio', command: 'npx', args: ['-y', 'some-mcp'] } } }, null, 2) + '\n'); await n.mgr.apply(q, ok(q)); expect([...n.f.m.keys()]).toEqual([MCP]); // nothing to back up
  });
  it('update and remove change only that server; a duplicate add and an unknown name are refused', async () => {
    const r = rig({ files: { [MCP]: ORIGINAL_JSON } }); const up = await r.mgr.plan({ kind: 'update', engine: 'claude-code', scope: 'project', def: { name: 'b', transport: 'stdio', command: 'b2' }, root: r.root }); expect(JSON.parse(up.targets[0]!.newText).mcpServers.b.command).toBe('b2');
    const rm = await r.mgr.plan({ kind: 'remove', engine: 'claude-code', scope: 'project', name: 'a', root: r.root }); expect(Object.keys(JSON.parse(rm.targets[0]!.newText).mcpServers)).toEqual(['b']); await expect(r.mgr.plan({ kind: 'add', engine: 'claude-code', scope: 'project', def: { ...FILES, name: 'a' }, root: r.root })).rejects.toMatchObject({ code: 'exists' }); await expect(r.mgr.plan({ kind: 'remove', engine: 'claude-code', scope: 'project', name: 'nope', root: r.root })).rejects.toMatchObject({ code: 'not_found' });
  });
  it('an invalid file is not edited: the error says where, and nothing is written', async () => {
    const r = rig({ files: { [MCP]: '{ "mcpServers": { "a": } }' } }); const err = await r.mgr.plan({ kind: 'add', engine: 'claude-code', scope: 'project', def: FILES, root: r.root }).catch((e) => e); expect(err).toBeInstanceOf(InvalidConfig); expect(String(err.message)).toMatch(/line 1 column \d+/); expect(r.f.writes).toEqual([]);
    for (const bad of ['[]', '"x"', '{"mcpServers": []}']) await expect(rig({ files: { [MCP]: bad } }).mgr.plan({ kind: 'add', engine: 'claude-code', scope: 'project', def: FILES, root: '/proj' }), bad).rejects.toBeInstanceOf(InvalidConfig);
  });
  it('references become ${VAR}; an Authorization header gets Bearer; http and sse keep their type', () => {
    expect(toClaude({ name: 'gh', transport: 'stdio', command: 'gh-mcp', env_refs: { GITHUB_TOKEN: 'GITHUB_TOKEN' }, env: { LOG_LEVEL: 'debug' } })).toEqual({ type: 'stdio', command: 'gh-mcp', env: { GITHUB_TOKEN: '${GITHUB_TOKEN}', LOG_LEVEL: 'debug' } });
    expect(toClaude({ name: 'api', transport: 'http', url: 'https://x.example.com/mcp', header_refs: { Authorization: 'API_KEY', 'X-Team': 'TEAM' } })).toEqual({ type: 'http', url: 'https://x.example.com/mcp', headers: { Authorization: 'Bearer ${API_KEY}', 'X-Team': '${TEAM}' } }); expect(toClaude({ name: 's', transport: 'sse', url: 'https://x.example.com/sse' }).type).toBe('sse');
  });
  it('list reads the servers back (names of variables only), hides the built-in, and claudeConfigArg has only what was asked for', async () => {
    const r = rig({ files: { [MCP]: JSON.stringify({ mcpServers: { gh: { command: 'g', env: { TOKEN: '${GH}', PLAIN: 'x' } }, 'centcom-approvals': { command: 'x' } } }) } }); const l = (await r.mgr.list('project', r.root))[0]!; expect(l.servers.map((s) => s.name)).toEqual(['gh']); expect(l.servers[0]!.env_refs).toEqual({ TOKEN: 'GH' }); expect(l.servers[0]!.env).toEqual({ PLAIN: '(set)' }); expect(l.builtin[0]!.name).toBe('centcom-approvals');
    expect(JSON.parse(claudeConfigArg([FILES, { name: 'centcom-approvals', transport: 'stdio', command: 'x' }]))).toEqual({ mcpServers: { files: { type: 'stdio', command: 'npx', args: ['-y', 'some-mcp'] } } });
  });
});

describe('Codex config.toml', () => {
  it('add writes exactly one [mcp_servers.files] table at the end; every other byte is identical (removing it gives the original back)', async () => {
    const r = rig({ files: { [TOML]: CODEX_TOML } }); const plan = await r.mgr.plan({ kind: 'add', engine: 'codex', scope: 'user', def: FILES, root: r.root }); await r.mgr.apply(plan, { ...ok(plan), userScope: true }); const t = r.f.m.get(TOML)!;
    expect(t.startsWith(CODEX_TOML)).toBe(true); expect(t.slice(CODEX_TOML.length)).toBe('\n[mcp_servers.files]\ncommand = "npx"\nargs = ["-y", "some-mcp"]\n'); expect((t.match(/^\[mcp_servers\.files\]/gm) ?? []).length).toBe(1); expect(setServerTable(t, 'files', undefined)).toBe(CODEX_TOML);
    const bak = [...r.f.m.keys()].find((k) => k.endsWith('.centcom-bak'))!; expect(r.f.m.get(bak)).toBe(CODEX_TOML);
  });
  it('update replaces that server and its sub-tables in place; remove deletes them; neighbours stay byte for byte', () => {
    const upd = setServerTable(CODEX_TOML, 'old', printTable('old', toCodex({ name: 'old', transport: 'stdio', command: 'new-cmd' }))); expect(upd).toBe(CODEX_TOML.replace('[mcp_servers.old]\ncommand = "old-cmd"\nargs = ["x"]\n\n[mcp_servers.old.env]\nLEVEL = "debug"\n', '[mcp_servers.old]\ncommand = "new-cmd"\n'));
    const del = setServerTable(CODEX_TOML, 'old', undefined); expect(del).toBe('# my codex config\nmodel = "gpt-5"\n\n[projects."/work"]\ntrust_level = "trusted"\n\n[tui]\nnotifications = true\n'); expect(setServerTable(CODEX_TOML, 'absent', undefined)).toBe(CODEX_TOML);
  });
  it('CRLF files get CRLF tables and keep their own endings elsewhere', () => { const crlf = 'model = "x"\r\n'; const out = setServerTable(crlf, 'f', printTable('f', toCodex(FILES), '\r\n')); expect(out.replace(/\r\n/g, '')).not.toContain('\n'); expect(out.startsWith(crlf)).toBe(true); expect(out).toContain('[mcp_servers.f]\r\ncommand = "npx"'); });
  it('http servers use url and the bearer-token variable; secrets are referenced by name only', () => {
    const t = printTable('api', toCodex({ name: 'api', transport: 'http', url: 'https://x.example.com/mcp', header_refs: { Authorization: 'API_TOKEN', 'X-Org': 'ORG' } })); expect(t).toBe('[mcp_servers.api]\nurl = "https://x.example.com/mcp"\nbearer_token_env_var = "API_TOKEN"\nenv_http_headers = { X-Org = "ORG" }\n');
    expect(printTable('g', toCodex({ name: 'g', transport: 'stdio', command: 'gh', env_refs: { GITHUB_TOKEN: 'GITHUB_TOKEN' } }))).toContain('env_vars = ["GITHUB_TOKEN"]');
  });
  it('what Codex cannot express is refused clearly, never widened', () => { expect(() => toCodex({ name: 's', transport: 'sse', url: 'https://x.example.com' })).toThrow(/sse/); expect(() => toCodex({ name: 'g', transport: 'stdio', command: 'g', env_refs: { A: 'B' } })).toThrow(McpError); });
  it('list parses the tables back, including sub-tables, and ignores everything else', () => {
    const s = parseServers(CODEX_TOML); expect(Object.keys(s)).toEqual(['old']); expect(s.old).toMatchObject({ command: 'old-cmd', args: ['x'], env: { LEVEL: 'debug' } }); expect(parseServers('model = 1\n')).toEqual({}); expect(splitLines('a\r\nb\nc').join('')).toBe('a\r\nb\nc'); expect(parseServers('[mcp_servers."quoted"]\ncommand = \'raw\'\nenabled = true\ncount = 3\n').quoted).toEqual({ command: 'raw', enabled: true, count: 3 });
  });
  it('project scope uses .codex/config.toml; Claude has no user scope and says how to do it', async () => {
    const r = rig(); const p = await r.mgr.plan({ kind: 'add', engine: 'codex', scope: 'project', def: FILES, root: r.root }); expect(p.targets[0]!.path).toBe('/proj/.codex/config.toml'); await expect(r.mgr.plan({ kind: 'add', engine: 'claude-code', scope: 'user', def: FILES })).rejects.toMatchObject({ code: 'unsupported' }); const both = await r.mgr.plan({ kind: 'add', engine: 'both', scope: 'project', def: FILES, root: r.root }); expect(both.targets.map((t) => t.engine)).toEqual(['claude-code', 'codex']);
    const bothUser = await r.mgr.plan({ kind: 'add', engine: 'both', scope: 'user', def: FILES }); expect(bothUser.targets.map((t) => t.engine)).toEqual(['codex']); expect((await r.mgr.list('user'))[0]!.unsupported).toContain('claude mcp add');
  });
});

describe('plan and apply', () => {
  it('a stale plan hash or a changed file writes nothing and throws PlanChanged', async () => {
    const r = rig({ files: { [MCP]: ORIGINAL_JSON } }); const plan = await r.mgr.plan({ kind: 'add', engine: 'claude-code', scope: 'project', def: FILES, root: r.root }); r.f.m.set(MCP, ORIGINAL_JSON + ' '); await expect(r.mgr.apply(plan, ok(plan))).rejects.toBeInstanceOf(McpPlanChanged); expect(r.f.writes).toEqual([]);
    r.f.m.set(MCP, ORIGINAL_JSON); await expect(r.mgr.apply(plan, { accepted: true, planHash: 'stale' })).rejects.toBeInstanceOf(McpPlanChanged); await expect(r.mgr.apply({ ...plan, targets: [{ ...plan.targets[0]!, newText: '{"evil":1}' }] }, ok(plan))).rejects.toBeInstanceOf(McpPlanChanged); expect(r.f.writes).toEqual([]);
  });
  it('no confirmation, no write; user scope also needs its own confirmation', async () => {
    const r = rig(); const plan = await r.mgr.plan({ kind: 'add', engine: 'codex', scope: 'user', def: FILES }); await expect(r.mgr.apply(plan, { accepted: false, planHash: plan.planHash } as never)).rejects.toMatchObject({ code: 'not_confirmed' }); await expect(r.mgr.apply(plan, ok(plan))).rejects.toMatchObject({ code: 'needs_user_confirm' }); expect(r.f.writes).toEqual([]); await r.mgr.apply(plan, { ...ok(plan), userScope: true }); expect(r.f.writes).toEqual([TOML]);
  });
  it('a file created by someone else after the plan counts as a change', async () => { const r = rig(); const plan = await r.mgr.plan({ kind: 'add', engine: 'claude-code', scope: 'project', def: FILES, root: r.root }); r.f.m.set(MCP, '{}'); await expect(r.mgr.apply(plan, ok(plan))).rejects.toBeInstanceOf(McpPlanChanged); });
  it('http servers do not get the "runs a program" warning', async () => { const r = rig(); const p = await r.mgr.plan({ kind: 'add', engine: 'claude-code', scope: 'project', def: { name: 'api', transport: 'http', url: 'https://x.example.com' }, root: r.root }); expect(p.warnings).toEqual([]); });
});

describe('built-in approvals server', () => {
  it('is listed, locked, and never written', async () => {
    const r = rig(); const l = await r.mgr.list('project', r.root); for (const e of l) expect(e.builtin.map((b) => b.name)).toEqual(['centcom-approvals']);
    for (const kind of ['remove', 'update', 'add'] as const) await expect(r.mgr.plan({ kind, engine: 'claude-code', scope: 'project', root: r.root, name: 'centcom-approvals', def: { ...FILES, name: 'centcom-approvals' } })).rejects.toBeInstanceOf(BuiltinServer);
    const p = await r.mgr.plan({ kind: 'add', engine: 'both', scope: 'project', def: FILES, root: r.root }); expect(p.targets.every((t) => !t.newText.includes('centcom-approvals'))).toBe(true); expect(claudeConfigArg([FILES])).not.toContain('centcom-approvals');
  });
});
