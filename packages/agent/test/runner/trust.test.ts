import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FileTrustStore, childEnv } from '../../src/runner/index.js';

const H = 'a'.repeat(64); const H2 = 'b'.repeat(64);
const fresh = async () => { const dir = await mkdtemp(join(tmpdir(), 'cc-trust-')); return { dir, file: join(dir, 'trust.json') }; };

describe('TrustStore', () => {
  it('trust persists across a restart, is per kind, can be revoked, and the file is 0600', async () => {
    const { file } = await fresh(); const a = new FileTrustStore(file); expect(await a.isTrusted('mcp', H)).toBe(false); await a.trust('mcp', H, 'github server');
    const b = new FileTrustStore(file); expect(await b.isTrusted('mcp', H)).toBe(true); expect(await b.isTrusted('hooks', H)).toBe(false); expect(await b.isTrusted('mcp', H2)).toBe(false); expect((await stat(file)).mode & 0o777).toBe(0o600);
    await b.revoke('mcp', H); expect(await new FileTrustStore(file).isTrusted('mcp', H)).toBe(false);
  });
  it('a corrupted file is treated as empty and kept as trust.json.corrupt', async () => {
    const { file } = await fresh(); await writeFile(file, '{ nope'); const s = new FileTrustStore(file); expect(await s.isTrusted('hooks', H)).toBe(false); expect(await readFile(file + '.corrupt', 'utf8')).toBe('{ nope'); await s.trust('hooks', H, 'x'); expect(await new FileTrustStore(file).isTrusted('hooks', H)).toBe(true);
  });
  it('a file that is valid JSON of the wrong shape, or with junk entries, trusts nothing it should not', async () => {
    const { file } = await fresh(); await writeFile(file, JSON.stringify({ v: 1, trusted: { 'mcp:short': { label: 'x' }, ['mcp:' + H]: { label: 'ok', at: 't' }, ['evil:' + H]: { label: 'x' } } })); const s = new FileTrustStore(file); expect(await s.isTrusted('mcp', H)).toBe(true);
    const f2 = (await fresh()).file; await writeFile(f2, '[1,2]'); expect(await new FileTrustStore(f2).isTrusted('mcp', H)).toBe(false);
  });
  it('rejects malformed hashes and kinds instead of storing them', async () => { const { file } = await fresh(); const s = new FileTrustStore(file); await expect(s.trust('mcp', 'zz', 'x')).rejects.toThrow(TypeError); await expect(s.isTrusted('nope' as never, H)).rejects.toThrow(TypeError); });
});

describe('childEnv', () => {
  it('drops everything outside the allow-list, keeps LC_*, adds only CENTCOM_AGENT_ID, and adds Windows variables only on Windows', () => {
    const parent = { PATH: 'p', LC_ALL: 'C', CENTCOM_TOKEN: 't', GITHUB_TOKEN: 'g', SystemRoot: 'C:\\Windows' }; expect(childEnv(parent, 'agt_1', 'linux')).toEqual({ PATH: 'p', LC_ALL: 'C', CENTCOM_AGENT_ID: 'agt_1' }); expect(childEnv(parent, 'agt_1', 'win32')).toMatchObject({ SystemRoot: 'C:\\Windows' });
  });
});
