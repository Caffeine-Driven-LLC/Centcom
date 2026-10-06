import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { McpSecretRejected, jsonErrorAt, urlAllowed, validateDef, type McpServerDef } from '../../src/index.js';
import { FILES, ok, rig } from './helpers.js';

const FX = JSON.parse(readFileSync(fileURLToPath(new URL('../../../../contracts/fixtures/providers/secret-patterns.json', import.meta.url)), 'utf8')) as { must_match: string[] };
const TOKEN = 'ghp_' + 'a1B2c3D4e5'.repeat(4).slice(0, 36);
const plan = (r: ReturnType<typeof rig>, def: McpServerDef) => r.mgr.plan({ kind: 'add', engine: 'both', scope: 'project', def, root: r.root });

describe('secrets', () => {
  it('a literal token in env is refused with SecretRejected and nothing is written (the error never contains it)', async () => {
    const r = rig(); const err = await plan(r, { ...FILES, env: { GITHUB_TOKEN: TOKEN } }).catch((e) => e); expect(err).toBeInstanceOf(McpSecretRejected); expect(err.code).toBe('secret_rejected'); expect(JSON.stringify(err) + err.message + err.stack).not.toContain(TOKEN.slice(4, 20)); expect(r.f.writes).toEqual([]);
    const key = await plan(r, { ...FILES, env: { GH_AUTH: TOKEN } }).catch((e) => e); expect(key).toBeInstanceOf(McpSecretRejected);
  });
  it('a secret-looking setting name needs a reference even if the value looks harmless; a ${VAR} value is fine', () => {
    expect(() => validateDef({ ...FILES, env: { API_KEY: 'hunter2' } })).toThrow(McpSecretRejected); expect(() => validateDef({ ...FILES, env: { MY_SECRET: 'x' } })).toThrow(McpSecretRejected); expect(() => validateDef({ ...FILES, env: { API_KEY: '${API_KEY}' } })).not.toThrow(); expect(() => validateDef({ ...FILES, env: { LOG_LEVEL: 'debug', MODE: 'fast' } })).not.toThrow();
  });
  it('secrets in the command, the arguments or the URL are refused too; every contract must_match string', () => {
    expect(() => validateDef({ ...FILES, args: ['--token', TOKEN] })).toThrow(McpSecretRejected); expect(() => validateDef({ name: 'a', transport: 'http', url: 'https://user:hunter2@example.com/mcp' })).toThrow(McpSecretRejected); expect(() => validateDef({ ...FILES, args: ['-----BEGIN PRIVATE KEY-----'] })).toThrow(McpSecretRejected);
    for (const s of FX.must_match) expect(() => validateDef({ ...FILES, args: [s] }), s).toThrow(McpSecretRejected);
  });
  it('a token pasted as a variable name or a header reference is a secret too', () => { expect(() => validateDef({ ...FILES, env_refs: { A: TOKEN } })).toThrow(McpSecretRejected); expect(() => validateDef({ ...FILES, env_refs: { [TOKEN]: 'A' } })).toThrow(McpSecretRejected); expect(() => validateDef({ name: 'a', transport: 'http', url: 'https://a.example.com', header_refs: { Authorization: TOKEN } })).toThrow(McpSecretRejected); });
  it('env references write only the variable name: the token in the environment is never read, and a grep of both files finds none', async () => {
    process.env.GITHUB_TOKEN = TOKEN; try { const r = rig(); const p = await plan(r, { ...FILES, env_refs: { GITHUB_TOKEN: 'GITHUB_TOKEN' }, header_refs: undefined }); await r.mgr.apply(p, ok(p)); const all = [...r.f.m.values()].join('\n'); expect(all).not.toContain(TOKEN); expect(all).toContain('${GITHUB_TOKEN}'); expect(all).toContain('env_vars = ["GITHUB_TOKEN"]'); expect(p.diff).not.toContain(TOKEN); }
    finally { delete process.env.GITHUB_TOKEN; }
  });
  it('logs carry counts only', async () => { const logs: string[] = []; const r = rig(); const p = await plan(r, FILES); void logs; await r.mgr.apply(p, ok(p)); expect(JSON.stringify(r.events)).not.toContain('npx'); });
});

describe('definitions', () => {
  it.each(['Files', '1x', 'a b', '', 'a'.repeat(33), 'a/b', '../x', 'a.b'])('the name %j is refused', (name) => { expect(() => validateDef({ ...FILES, name })).toThrow(/name/); });
  it.each(['a', 'files', 'my-server_2', 'a'.repeat(32)])('the name %j is fine', (name) => { expect(() => validateDef({ ...FILES, name })).not.toThrow(); });
  it('stdio needs a command and no URL; http and sse need an allowed URL and no command; bad shapes are refused', () => {
    expect(() => validateDef({ name: 'a', transport: 'stdio' })).toThrow(); expect(() => validateDef({ name: 'a', transport: 'stdio', command: 'x', url: 'https://a.com' })).toThrow(); expect(() => validateDef({ name: 'a', transport: 'http' })).toThrow(); expect(() => validateDef({ name: 'a', transport: 'http', url: 'https://a.com', command: 'x' })).toThrow();
    expect(() => validateDef({ name: 'a', transport: 'carrier-pigeon' as never, command: 'x' })).toThrow(); expect(() => validateDef({ ...FILES, args: [5 as never] })).toThrow(); expect(() => validateDef({ ...FILES, env_refs: { 'BAD NAME': 'X' } })).toThrow(); expect(() => validateDef({ ...FILES, command: 'x\ny' })).toThrow(); expect(() => validateDef(null as never)).toThrow();
  });
});

describe('URL rules', () => {
  it.each([['http://example.com', false], ['https://example.com', true], ['http://127.0.0.1:8080', true], ['http://localhost:3000/mcp', true], ['http://[::1]:9/x', true], ['ftp://example.com', false], ['file:///etc/passwd', false], ['javascript:alert(1)', false], ['not a url', false], ['http://127.0.0.1.evil.com', false], ['http://localhost.evil.com', false], ['https://example.com:8443/a?b=c', true]])('%s -> %s', (u, ok) => { expect(urlAllowed(u)).toBe(ok); });
  it('the definition check uses the same rule', () => { expect(() => validateDef({ name: 'a', transport: 'http', url: 'http://example.com' })).toThrow(/URL/); expect(() => validateDef({ name: 'a', transport: 'sse', url: 'https://example.com' })).not.toThrow(); });
});

describe('json error position', () => { it.each([['{ "a": }', 'line 1 column 8'], ['{\n  "a": 1,\n  oops\n}', 'line 3 column 3'], ['{"a":1,}', 'line 1 column 8'], ['[1 2]', 'line 1 column 4'], ['{"a": "unterminated', 'line 1 column 20'], ['', 'line 1 column 1']])('%j -> %s', (t, at) => { expect(jsonErrorAt(t)).toBe(at); }); it('valid JSON has no error', () => { expect(jsonErrorAt('{"a":[1,2,{"b":null}],"c":"d\\n"}')).toBeUndefined(); expect(jsonErrorAt(' [ ] ')).toBeUndefined(); }); });
