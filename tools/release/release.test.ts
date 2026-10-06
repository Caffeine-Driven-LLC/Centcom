// C012 release engineering: build metadata, signing, the release manifest, the release workflow and Changesets.
// Everything runs offline in temp dirs; signing keys are generated here at run time and never written to the repo.
import { spawnSync } from 'node:child_process';
import { createHash, generateKeyPairSync, verify, type KeyObject } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { write_release_manifest } from '../../packages/protocol/src/generated/validators-strict.js';
import { read_release_manifest } from '../../packages/protocol/src/generated/validators-tolerant.js';
import { buildMeta, channelVersion, readContractVersion, resolveNow, utcDay } from './build-meta.mjs';
import { buildManifest, kindOf, scanArtifacts, TARGETS } from './manifest.mjs';
import { decodeSig, digestEquals, signFile } from './sign.mjs';

const ROOT = join(__dirname, '../..');
const TOOLS = join(ROOT, 'tools/release');
const CONTRACT_VERSION: string = JSON.parse(readFileSync(join(ROOT, 'contracts/index.json'), 'utf8')).contract_version;
const POSIX = process.platform !== 'win32';

const temps: string[] = [];
const tmp = (p: string) => { const d = mkdtempSync(join(tmpdir(), `c012-${p}-`)); temps.push(d); return d; };
afterAll(() => { for (const d of temps) rmSync(d, { recursive: true, force: true }); });

/** Child env without CI variables that would change the outcome. */
const cleanEnv = (extra: Record<string, string> = {}) => {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !['GITHUB_SHA', 'GITHUB_RUN_NUMBER', 'SOURCE_DATE_EPOCH'].includes(k)) env[k] = v;
  return { ...env, ...extra };
};
const run = (script: string, args: string[], extra: Record<string, string> = {}) => spawnSync(process.execPath, [join(TOOLS, script), ...args], { encoding: 'utf8', env: cleanEnv(extra), timeout: 30_000 });

interface Keys { priv: KeyObject; pub: KeyObject; keyFile: string; pubFile: string; pem: string }
/** A throwaway Ed25519 key pair in a temp dir; the private key file gets `mode`. */
function makeKeys(mode = 0o600): Keys {
  const d = tmp('keys');
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const keyFile = join(d, 'release.key'), pubFile = join(d, 'release.pub');
  writeFileSync(keyFile, pem, { mode });
  chmodSync(keyFile, mode);
  writeFileSync(pubFile, publicKey.export({ type: 'spki', format: 'pem' }));
  return { priv: privateKey, pub: publicKey, keyFile, pubFile, pem };
}
/** Base64 body lines of a PEM, used to prove no key material leaked into output. */
const pemBody = (pem: string) => pem.split('\n').filter((l) => l && !l.startsWith('-----'));
const sha256 = (b: Buffer) => createHash('sha256').update(b).digest();

describe('build-meta.mjs', () => {
  const NIGHTLY_NOW = '2026-10-05T12:34:56.789Z';

  it('stamps a nightly on 2026-10-05 with the contract version (acceptance 1)', () => {
    const out = join(tmp('meta'), 'dist/build-meta.json');
    const r = run('build-meta.mjs', ['--channel', 'nightly', '--now', NIGHTLY_NOW, '--out', out]);
    expect(r.status, r.stderr).toBe(0);
    const meta = JSON.parse(readFileSync(out, 'utf8'));
    expect(meta.version).toMatch(/^\d+\.\d+\.\d+-nightly\.20261005$/);
    expect(meta.contract_version).toBe(CONTRACT_VERSION);
    expect(meta.built_at).toBe(NIGHTLY_NOW);
    expect(meta.channel).toBe('nightly');
    expect(meta.node).toBe(process.versions.node);
    expect(meta.commit).toMatch(/^([0-9a-f]{40}|unknown)$/);
    expect(Object.keys(meta).sort()).toEqual(['built_at', 'channel', 'commit', 'contract_version', 'node', 'version']);
  });

  it('records no hostname, username or absolute path', () => {
    const out = join(tmp('meta'), 'm.json');
    expect(run('build-meta.mjs', ['--channel', 'stable', '--now', NIGHTLY_NOW, '--out', out]).status).toBe(0);
    const text = readFileSync(out, 'utf8');
    const meta = JSON.parse(text) as Record<string, string>;
    for (const v of Object.values(meta)) { expect(v.startsWith('/')).toBe(false); expect(/^[A-Za-z]:\\/.test(v)).toBe(false); }
    expect(text).not.toContain(ROOT);
    expect(text).not.toContain(hostname());
    const user = userInfo().username;
    if (user.length >= 3) expect(text).not.toContain(user);
  });

  it('versions every channel: stable x.y.z, beta x.y.z-beta.N, nightly x.y.z-nightly.YYYYMMDD', () => {
    const now = new Date(NIGHTLY_NOW);
    expect(channelVersion('1.4.2', 'stable', { now })).toBe('1.4.2');
    expect(channelVersion('1.4.2', 'beta', { now, betaNumber: 7 })).toBe('1.4.2-beta.7');
    expect(channelVersion('1.4.2', 'beta', { now })).toBe('1.4.2-beta.1');
    expect(channelVersion('1.4.2', 'nightly', { now })).toBe('1.4.2-nightly.20261005');
    expect(() => channelVersion('1.4.2', 'canary' as never, { now })).toThrow(/unknown channel/);
    expect(() => channelVersion('1.4', 'stable', { now })).toThrow(/x\.y\.z/);
    expect(() => channelVersion('1.4.2', 'beta', { now, betaNumber: -1 })).toThrow(/beta number/);
  });

  it('uses the UTC day for nightlies, whatever the offset of the injected time', () => {
    expect(utcDay(new Date('2026-10-05T23:59:59.999-02:00'))).toBe('20261006');
    expect(utcDay(new Date('2026-10-06T00:30:00+05:00'))).toBe('20261005');
  });

  it('runs every channel through the CLI, with the beta number from the flag or the CI run number', () => {
    const d = tmp('meta');
    const read = (f: string) => JSON.parse(readFileSync(join(d, f), 'utf8'));
    expect(run('build-meta.mjs', ['--channel', 'stable', '--now', NIGHTLY_NOW, '--out', join(d, 's.json')]).status).toBe(0);
    expect(read('s.json').version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(run('build-meta.mjs', ['--channel', 'beta', '--beta-number', '3', '--now', NIGHTLY_NOW, '--out', join(d, 'b.json')]).status).toBe(0);
    expect(read('b.json').version).toMatch(/^\d+\.\d+\.\d+-beta\.3$/);
    expect(run('build-meta.mjs', ['--channel', 'beta', '--now', NIGHTLY_NOW, '--out', join(d, 'b2.json')], { GITHUB_RUN_NUMBER: '42' }).status).toBe(0);
    expect(read('b2.json').version).toMatch(/^\d+\.\d+\.\d+-beta\.42$/);
    expect(run('build-meta.mjs', ['--now', NIGHTLY_NOW, '--out', join(d, 'n.json')]).status).toBe(0);
    expect(read('n.json').channel).toBe('nightly');
  });

  it('takes the build time from SOURCE_DATE_EPOCH when --now is absent', () => {
    const out = join(tmp('meta'), 'm.json');
    const epoch = String(Date.UTC(2026, 9, 5, 1, 2, 3) / 1000);
    expect(run('build-meta.mjs', ['--channel', 'nightly', '--out', out], { SOURCE_DATE_EPOCH: epoch }).status).toBe(0);
    const meta = JSON.parse(readFileSync(out, 'utf8'));
    expect(meta.built_at).toBe('2026-10-05T01:02:03.000Z');
    expect(meta.version).toMatch(/-nightly\.20261005$/);
    expect(resolveNow(undefined, {}, () => new Date(0)).getTime()).toBe(0);
    expect(() => resolveNow('yesterday', {})).toThrow(/RFC 3339/);
    expect(() => resolveNow(undefined, { SOURCE_DATE_EPOCH: 'soon' })).toThrow(/SOURCE_DATE_EPOCH/);
  });

  it('prefers an explicit commit, then GITHUB_SHA', () => {
    const now = new Date(NIGHTLY_NOW);
    const a = 'a'.repeat(40), b = 'b'.repeat(40);
    expect(buildMeta({ root: ROOT, channel: 'stable', now, commit: a, env: { GITHUB_SHA: b } }).commit).toBe(a);
    expect(buildMeta({ root: ROOT, channel: 'stable', now, env: { GITHUB_SHA: b } }).commit).toBe(b);
  });

  /** A fake repo root with two @centcom packages and, optionally, contracts/index.json. */
  const fakeRoot = (index: string | null, versions = ['1.2.3', '1.2.3']) => {
    const r = tmp('root');
    versions.forEach((v, i) => { mkdirSync(join(r, 'packages', `p${i}`), { recursive: true }); writeFileSync(join(r, 'packages', `p${i}`, 'package.json'), JSON.stringify({ name: `@centcom/p${i}`, version: v })); });
    if (index !== null) { mkdirSync(join(r, 'contracts')); writeFileSync(join(r, 'contracts/index.json'), index); }
    return r;
  };

  it('exits 2 and writes nothing when contracts/index.json is unreadable', () => {
    for (const index of [null, '{not json', JSON.stringify({ contract_version: 7 })]) {
      const r = fakeRoot(index);
      const out = join(r, 'dist/build-meta.json');
      const res = run('build-meta.mjs', ['--root', r, '--channel', 'stable', '--out', out]);
      expect(res.status).toBe(2);
      expect(res.stderr).toMatch(/contract_version|contracts\/index\.json/);
      expect(existsSync(out)).toBe(false);
    }
    expect(() => readContractVersion(fakeRoot(null))).toThrow();
  });

  it('works in a fake root, outside git, with commit "unknown"', () => {
    const r = fakeRoot(JSON.stringify({ contract_version: '9.8.7' }));
    const res = run('build-meta.mjs', ['--root', r, '--channel', 'stable', '--now', NIGHTLY_NOW]);
    expect(res.status, res.stderr).toBe(0);
    const meta = JSON.parse(readFileSync(join(r, 'dist/build-meta.json'), 'utf8'));
    expect(meta).toMatchObject({ version: '1.2.3', contract_version: '9.8.7', channel: 'stable' });
    expect(meta.commit === 'unknown' || /^[0-9a-f]{40}$/.test(meta.commit)).toBe(true);
  });

  it('exits 2 when the fixed group disagrees, the channel is unknown or the input is bad', () => {
    const idx = JSON.stringify({ contract_version: '1.0.0' });
    expect(run('build-meta.mjs', ['--root', fakeRoot(idx, ['1.0.0', '1.1.0'])]).stderr).toMatch(/disagree/);
    expect(run('build-meta.mjs', ['--root', fakeRoot(idx, ['1.0.0', '1.1.0'])]).status).toBe(2);
    expect(run('build-meta.mjs', ['--root', fakeRoot(idx, [])]).status).toBe(2);
    expect(run('build-meta.mjs', ['--root', fakeRoot(idx), '--channel', 'canary']).status).toBe(2);
    expect(run('build-meta.mjs', ['--root', fakeRoot(idx), '--now', 'tomorrow']).status).toBe(2);
    expect(run('build-meta.mjs', ['--root', fakeRoot(idx), '--channel', 'beta', '--beta-number', 'x']).status).toBe(2);
    expect(run('build-meta.mjs', ['--root', fakeRoot(idx), '--bogus']).status).toBe(2);
  });
});

describe('sign.mjs', () => {
  const artifact = (bytes = Buffer.from('centcom artifact bytes\n')) => { const f = join(tmp('art'), 'centcom-linux-x64.tar.gz'); writeFileSync(f, bytes); return f; };

  it('signs the raw SHA-256 digest and verifies with the matching public key (acceptance 2)', () => {
    const k = makeKeys(), f = artifact();
    const s = run('sign.mjs', ['--file', f, '--key-file', k.keyFile]);
    expect(s.status, s.stderr).toBe(0);
    const sig = readFileSync(`${f}.sig`, 'utf8').trim();
    expect(sig).toMatch(/^[A-Za-z0-9_-]{86}$/);
    expect(verify(null, sha256(readFileSync(f)), k.pub, Buffer.from(sig, 'base64url'))).toBe(true);
    const v = run('sign.mjs', ['--verify', '--file', f, '--sig', `${f}.sig`, '--pub', k.pubFile]);
    expect(v.status, v.stderr).toBe(0);
    for (const line of pemBody(k.pem)) expect(s.stdout + s.stderr + v.stdout + v.stderr).not.toContain(line);
  });

  it('fails (exit 1) after one byte of the file is flipped', () => {
    const k = makeKeys(), f = artifact();
    expect(run('sign.mjs', ['--file', f, '--key-file', k.keyFile]).status).toBe(0);
    const b = readFileSync(f); b[3] = b[3]! ^ 0x01; writeFileSync(f, b);
    expect(run('sign.mjs', ['--verify', '--file', f, '--sig', `${f}.sig`, '--pub', k.pubFile]).status).toBe(1);
  });

  it('fails (exit 1) with the wrong public key or a malformed signature', () => {
    const k = makeKeys(), other = makeKeys(), f = artifact();
    expect(run('sign.mjs', ['--file', f, '--key-file', k.keyFile]).status).toBe(0);
    expect(run('sign.mjs', ['--verify', '--file', f, '--sig', `${f}.sig`, '--pub', other.pubFile]).status).toBe(1);
    writeFileSync(`${f}.sig`, 'not-a-signature');
    expect(run('sign.mjs', ['--verify', '--file', f, '--sig', `${f}.sig`, '--pub', k.pubFile]).status).toBe(1);
  });

  it('checks a manifest digest in constant time before the signature (--sha256)', () => {
    const k = makeKeys(), f = artifact();
    expect(run('sign.mjs', ['--file', f, '--key-file', k.keyFile]).status).toBe(0);
    const good = sha256(readFileSync(f)).toString('hex');
    expect(run('sign.mjs', ['--verify', '--file', f, '--sig', `${f}.sig`, '--pub', k.pubFile, '--sha256', good]).status).toBe(0);
    const bad = (good[0] === '0' ? '1' : '0') + good.slice(1);
    const r = run('sign.mjs', ['--verify', '--file', f, '--sig', `${f}.sig`, '--pub', k.pubFile, '--sha256', bad]);
    expect(r.status).toBe(1); expect(r.stderr).toMatch(/digest/);
    expect(run('sign.mjs', ['--verify', '--file', f, '--sig', `${f}.sig`, '--pub', k.pubFile, '--sha256', 'xyz']).status).toBe(2);
    expect(digestEquals(Buffer.from('ab'), Buffer.from('ab'))).toBe(true);
    expect(digestEquals(Buffer.from('ab'), Buffer.from('ac'))).toBe(false);
    expect(digestEquals(Buffer.from('ab'), Buffer.from('abc'))).toBe(false);
  });

  it('fails closed without a key: exit 2, no signature, no key material printed', () => {
    const k = makeKeys(), f = artifact();
    const r = run('sign.mjs', ['--file', f]);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/no signing key/);
    expect(existsSync(`${f}.sig`)).toBe(false);
    for (const line of pemBody(k.pem)) expect(r.stdout + r.stderr).not.toContain(line);
  });

  it.runIf(POSIX)('refuses a key file whose mode is not 0600 (acceptance 3)', () => {
    for (const mode of [0o644, 0o640, 0o604, 0o700, 0o400]) {
      const k = makeKeys(mode), f = artifact();
      const r = run('sign.mjs', ['--file', f, '--key-file', k.keyFile]);
      expect(r.status, mode.toString(8)).toBe(2);
      expect(r.stderr).toMatch(/0600/);
      expect(existsSync(`${f}.sig`)).toBe(false);
      for (const line of pemBody(k.pem)) expect(r.stdout + r.stderr).not.toContain(line);
    }
  });

  it('exits 2 without touching the artifact when the key file is unreadable or not Ed25519', () => {
    const f = artifact(), before = readFileSync(f);
    const missing = run('sign.mjs', ['--file', f, '--key-file', join(tmp('nokey'), 'absent.key')]);
    expect(missing.status).toBe(2); expect(missing.stderr).toMatch(/unreadable/);
    const garbage = join(tmp('badkey'), 'k.key'); writeFileSync(garbage, 'hello', { mode: 0o600 }); chmodSync(garbage, 0o600);
    expect(run('sign.mjs', ['--file', f, '--key-file', garbage]).status).toBe(2);
    const ec = join(tmp('eckey'), 'k.key');
    writeFileSync(ec, generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 }); chmodSync(ec, 0o600);
    const r = run('sign.mjs', ['--file', f, '--key-file', ec]);
    expect(r.status).toBe(2); expect(r.stderr).toMatch(/Ed25519/);
    expect(readFileSync(f).equals(before)).toBe(true);
    expect(existsSync(`${f}.sig`)).toBe(false);
  });

  it('exits 2 on usage errors, a missing artifact or a missing public key', () => {
    const k = makeKeys(), f = artifact();
    expect(run('sign.mjs', []).status).toBe(2);
    expect(run('sign.mjs', ['--file', f, '--nope']).status).toBe(2);
    expect(run('sign.mjs', ['--file', join(tmp('gone'), 'x'), '--key-file', k.keyFile]).status).toBe(2);
    expect(run('sign.mjs', ['--verify', '--file', f, '--pub', k.pubFile]).status).toBe(2);
    expect(run('sign.mjs', ['--file', f, '--key-file', k.keyFile]).status).toBe(0);
    expect(run('sign.mjs', ['--verify', '--file', f, '--sig', `${f}.sig`, '--pub', join(tmp('gone'), 'p')]).status).toBe(2);
    expect(run('sign.mjs', ['--verify', '--file', f, '--sig', join(tmp('gone'), 's'), '--pub', k.pubFile]).status).toBe(2);
  });

  it('accepts only 64-byte unpadded base64url signatures', () => {
    expect(decodeSig(Buffer.alloc(64, 1).toString('base64url'))).not.toBeNull();
    expect(decodeSig(Buffer.alloc(63, 1).toString('base64url'))).toBeNull();
    expect(decodeSig(`${Buffer.alloc(64, 1).toString('base64')}`)).toBeNull();
    expect(decodeSig('')).toBeNull();
  });
});

describe('manifest.mjs', () => {
  const NOW = '2026-10-05T12:00:00.000Z';
  const files = (): Record<string, string> => ({
    'centcom-win32-x64.zip': 'windows build',
    'centcom-linux-arm64.tar.gz': 'linux arm build',
    'centcom-darwin-x64.tar.gz': 'mac intel build',
    'centcom-linux-x64.tar.gz': 'linux x64 build',
    'centcom-darwin-arm64.tar.gz': 'mac arm build',
  });

  /** Signed fake artifacts plus build metadata for `channel`. */
  async function setup(channel = 'nightly', names = files()) {
    const k = makeKeys(), d = tmp('dist'), dir = join(d, 'artifacts');
    mkdirSync(dir);
    for (const [n, body] of Object.entries(names)) { writeFileSync(join(dir, n), body); await signFile({ file: join(dir, n), keyFile: k.keyFile }); }
    writeFileSync(join(dir, 'README.txt'), 'not an artifact');
    writeFileSync(join(dir, 'centcom-linux-ia32.tar.gz'), 'unsupported target');
    const meta = join(d, 'build-meta.json');
    expect(run('build-meta.mjs', ['--channel', channel, '--now', NOW, '--out', meta]).status).toBe(0);
    return { k, d, dir, meta };
  }
  const assemble = (s: { dir: string; meta: string; k: Keys; d: string }, out: string, extra: string[] = [], channel = 'nightly') =>
    run('manifest.mjs', ['--channel', channel, '--dir', s.dir, '--out', out, '--meta', s.meta, '--pub', s.k.pubFile, '--now', NOW, ...extra]);

  it('lists exactly the 5 platform/arch pairs, sorted, and validates against the generated validator (acceptance 4)', async () => {
    const s = await setup();
    const out = join(s.d, 'manifest.json');
    const r = assemble(s, out);
    expect(r.status, r.stderr).toBe(0);
    const m = JSON.parse(readFileSync(out, 'utf8'));
    const pairs = m.artifacts.map((a: { platform: string; arch: string }) => `${a.platform}-${a.arch}`);
    expect(pairs).toEqual(['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64', 'win32-x64']);
    expect(pairs).toEqual([...pairs].sort());
    expect(write_release_manifest(m), JSON.stringify(write_release_manifest.errors)).toBe(true);
    expect(read_release_manifest(m)).toBe(true);
    expect(write_release_manifest({ ...m, artifacts: [] })).toBe(false);
    expect(write_release_manifest({ ...m, artifacts: [{ ...m.artifacts[0], sha256: `sha256:${m.artifacts[0].sha256}` }] })).toBe(false);
    expect(m).toMatchObject({ channel: 'nightly', released_at: NOW, contract_version: CONTRACT_VERSION, min_supported: '0.0.0' });
    expect(m.version).toMatch(/-nightly\.20261005$/);
    for (const a of m.artifacts) {
      const name = readdirSync(s.dir).find((n) => n.startsWith(`centcom-${a.platform}-${a.arch}.`))!;
      const bytes = readFileSync(join(s.dir, name));
      expect(a.sha256).toBe(sha256(bytes).toString('hex'));
      expect(a.size).toBe(bytes.length);
      expect(verify(null, sha256(bytes), s.k.pub, Buffer.from(a.sig, 'base64url'))).toBe(true);
      expect(a.url).toBe(`https://downloads.centcom.invalid/releases/nightly/${m.version}/${name}`);
    }
    expect(m.artifacts.find((a: { platform: string }) => a.platform === 'win32').kind).toBe('archive');
  });

  it('emits only fields the release-manifest schema defines', async () => {
    const schema = JSON.parse(readFileSync(join(ROOT, 'contracts/schemas/release-manifest.schema.json'), 'utf8'));
    const s = await setup();
    const out = join(s.d, 'm.json');
    expect(assemble(s, out, ['--sig-kid', 'rel-2026', '--notes-url', 'https://centcom.invalid/notes', '--min-supported', '0.1.0']).status).toBe(0);
    const m = JSON.parse(readFileSync(out, 'utf8'));
    for (const key of Object.keys(m)) expect(Object.keys(schema.properties)).toContain(key);
    for (const a of m.artifacts) for (const key of Object.keys(a)) expect(Object.keys(schema.properties.artifacts.items.properties)).toContain(key);
    expect(m.artifacts[0].sig_kid).toBe('rel-2026');
    expect(write_release_manifest(m)).toBe(true);
  });

  it('is deterministic: same inputs, same bytes, whatever the creation order', async () => {
    const a = await setup(), b = await setup('nightly', Object.fromEntries(Object.entries(files()).reverse()));
    const oa = join(a.d, 'm.json'), ob = join(b.d, 'm.json');
    expect(assemble(a, oa).status).toBe(0);
    expect(assemble(b, ob).status).toBe(0);
    const strip = (p: string) => { const m = JSON.parse(readFileSync(p, 'utf8')); for (const x of m.artifacts) delete x.sig; return JSON.stringify(m); };
    expect(strip(oa)).toBe(strip(ob));
    expect(assemble(a, join(a.d, 'm2.json')).status).toBe(0);
    expect(readFileSync(join(a.d, 'm2.json'), 'utf8')).toBe(readFileSync(oa, 'utf8'));
  });

  it('exits 1 naming every missing platform/arch pair', async () => {
    const names = files(); delete names['centcom-darwin-x64.tar.gz']; delete names['centcom-win32-x64.zip'];
    const s = await setup('nightly', names);
    const r = assemble(s, join(s.d, 'm.json'));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('darwin-x64');
    expect(r.stderr).toContain('win32-x64');
    expect(existsSync(join(s.d, 'm.json'))).toBe(false);
  });

  it('exits 1 on a duplicate pair, a missing .sig, a bad signature or an empty file', async () => {
    const dup = await setup('nightly', { ...files(), 'centcom-linux-x64.zip': 'second linux build' });
    expect(assemble(dup, join(dup.d, 'm.json')).stderr).toMatch(/more than one artifact for: linux-x64/);

    const nosig = await setup();
    rmSync(join(nosig.dir, 'centcom-linux-arm64.tar.gz.sig'));
    const r1 = assemble(nosig, join(nosig.d, 'm.json'));
    expect(r1.status).toBe(1); expect(r1.stderr).toMatch(/linux-arm64: no \.sig/);

    const tampered = await setup();
    writeFileSync(join(tampered.dir, 'centcom-darwin-arm64.tar.gz'), 'swapped after signing');
    const r2 = assemble(tampered, join(tampered.d, 'm.json'));
    expect(r2.status).toBe(1); expect(r2.stderr).toMatch(/darwin-arm64: signature does not verify/);

    const wrong = await setup();
    const r3 = run('manifest.mjs', ['--channel', 'nightly', '--dir', wrong.dir, '--out', join(wrong.d, 'm.json'), '--meta', wrong.meta, '--pub', makeKeys().pubFile, '--now', NOW]);
    expect(r3.status).toBe(1);

    const empty = await setup();
    writeFileSync(join(empty.dir, 'centcom-win32-x64.zip'), '');
    const r4 = assemble(empty, join(empty.d, 'm.json'));
    expect(r4.status).toBe(1); expect(r4.stderr).toMatch(/win32-x64: empty file/);
  });

  it('exits 2 on usage errors, a channel mismatch or unreadable metadata', async () => {
    const s = await setup('beta');
    expect(assemble(s, join(s.d, 'm.json'), [], 'stable').status).toBe(2);
    expect(run('manifest.mjs', ['--channel', 'nightly']).status).toBe(2);
    expect(run('manifest.mjs', ['--channel', 'beta', '--dir', s.dir, '--out', join(s.d, 'm.json'), '--meta', join(s.d, 'none.json')]).status).toBe(2);
    expect(assemble(s, join(s.d, 'm.json'), ['--base-url', 'not a url'], 'beta').status).toBe(2);
    expect(assemble(s, join(s.d, 'm.json'), ['--min-supported', 'old'], 'beta').status).toBe(2);
    expect(run('manifest.mjs', ['--channel', 'beta', '--dir', join(s.d, 'nope'), '--out', join(s.d, 'm.json'), '--meta', s.meta]).status).toBe(2);
    expect(assemble(s, join(s.d, 'm.json'), [], 'beta').status).toBe(0);
  });

  it('checks signature shape even without --pub, and says it did not verify', async () => {
    const s = await setup();
    const r = run('manifest.mjs', ['--channel', 'nightly', '--dir', s.dir, '--out', join(s.d, 'm.json'), '--meta', s.meta, '--now', NOW]);
    expect(r.status).toBe(0); expect(r.stderr).toMatch(/not verified/);
    writeFileSync(join(s.dir, 'centcom-linux-x64.tar.gz.sig'), 'short');
    expect(run('manifest.mjs', ['--channel', 'nightly', '--dir', s.dir, '--out', join(s.d, 'm.json'), '--meta', s.meta, '--now', NOW]).status).toBe(1);
  });

  it('classifies artifact kinds and builds in-process', async () => {
    expect(kindOf('centcom-linux-x64')).toBe('binary');
    expect(kindOf('centcom-win32-x64.exe')).toBe('binary');
    expect(kindOf('centcom-linux-x64.tgz')).toBe('npm');
    expect(kindOf('centcom-linux-x64.tar.xz')).toBe('archive');
    const s = await setup();
    expect(scanArtifacts(s.dir).map((a: { platform: string; arch: string }) => `${a.platform}-${a.arch}`)).toEqual([...TARGETS]);
    const meta = JSON.parse(readFileSync(s.meta, 'utf8'));
    const m = buildManifest({ channel: 'nightly', dir: s.dir, meta, now: new Date(NOW), publicKey: s.k.pub, baseUrl: 'https://cdn.invalid/x/' });
    expect(m.artifacts[0].url.startsWith('https://cdn.invalid/x/nightly/')).toBe(true);
    expect(write_release_manifest(m)).toBe(true);
  });
});

describe('release workflow', () => {
  const yml = readFileSync(join(ROOT, '.github/workflows/release.yml'), 'utf8');
  /** The workflow with YAML comments removed (whole-line and trailing `# ...`). */
  const code = yml.split('\n').map((l) => l.replace(/(^|\s)#.*$/, '')).join('\n');
  const FORBIDDEN = [/\bnpm\s+publish\b/, /\bpnpm\s+(-r\s+|--recursive\s+)?publish\b/, /\byarn\s+(npm\s+)?publish\b/, /\bgh\s+release\s+(create|upload)\b/, /\baws\s+s3\b/, /\bgsutil\b/, /\baz\s+storage\b/, /\brclone\b/, /\bwrangler\b/, /\bbrew\s+bump/, /\bcurl\b[^\n]*(-T|--upload-file)\b/];

  it('has no publish or upload-to-CDN command outside comments (acceptance 5)', () => {
    for (const re of FORBIDDEN) expect(re.test(code), String(re)).toBe(false);
    expect(/npm publish|pnpm -r publish/.test(yml)).toBe(true);
    expect(/gh release create/.test(yml)).toBe(true);
  });

  it('runs only on workflow_dispatch', () => {
    const lines = code.split('\n');
    const start = lines.findIndex((l) => /^on:\s*$/.test(l));
    expect(start).toBeGreaterThanOrEqual(0);
    const triggers: string[] = [];
    for (const l of lines.slice(start + 1)) { if (/^\S/.test(l)) break; const m = /^ {2}([A-Za-z_]+):/.exec(l); if (m) triggers.push(m[1]!); }
    expect(triggers).toEqual(['workflow_dispatch']);
    expect(code.match(/^on:/gm)).toHaveLength(1);
  });

  it('is gated by the release environment, pins actions by SHA and takes the key only from the secret', () => {
    expect(code).toMatch(/^\s+environment: release\s*$/m);
    const uses = [...code.matchAll(/uses:\s*(\S+)/g)].map((m) => m[1]!);
    expect(uses.length).toBeGreaterThan(0);
    for (const u of uses) expect(u, u).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/);
    expect(code).toContain('secrets.RELEASE_SIGNING_KEY');
    expect(code).toMatch(/permissions:\s*\n\s+contents: read/);
  });

  it('commits no signing key anywhere in the lane', () => {
    const paths = ['.github/workflows/release.yml', '.changeset/config.json', '.changeset/README.md', 'docs/releasing.md', ...readdirSync(TOOLS).map((f) => `tools/release/${f}`)];
    for (const p of paths) expect(readFileSync(join(ROOT, p), 'utf8'), p).not.toMatch(/-----BEGIN [A-Z ]*PRIVATE KEY-----/);
  });
});

describe('changesets', () => {
  const config = JSON.parse(readFileSync(join(ROOT, '.changeset/config.json'), 'utf8'));

  it('puts every @centcom/* package in one fixed group with a plain changelog and restricted access', () => {
    expect(config.fixed).toEqual([['@centcom/*']]);
    expect(config.changelog).toBe('@changesets/cli/changelog');
    expect(config.access).toBe('restricted');
    expect(config.privatePackages).toEqual({ version: true, tag: false });
  });

  /** All workspace package.json files, relative to the repo root. */
  const workspaceManifests = () => ['packages', 'apps'].flatMap((g) => readdirSync(join(ROOT, g)).filter((n) => existsSync(join(ROOT, g, n, 'package.json'))).map((n) => `${g}/${n}/package.json`));

  /** A throwaway git repo with this workspace's manifests and changeset config, on branch main. */
  function workspaceRepo() {
    const d = tmp('cs');
    const env = cleanEnv({ GIT_CONFIG_GLOBAL: join(d, '.no-global'), GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'Release Test', GIT_AUTHOR_EMAIL: 'release-test@example.invalid', GIT_COMMITTER_NAME: 'Release Test', GIT_COMMITTER_EMAIL: 'release-test@example.invalid' });
    const git = (...a: string[]) => { const r = spawnSync('git', ['-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...a], { cwd: d, env, encoding: 'utf8', timeout: 30_000 }); expect(r.status, r.stderr).toBe(0); return r.stdout; };
    for (const f of ['package.json', 'pnpm-workspace.yaml', '.changeset/config.json', ...workspaceManifests()]) { mkdirSync(join(d, f, '..'), { recursive: true }); copyFileSync(join(ROOT, f), join(d, f)); }
    writeFileSync(join(d, '.gitignore'), 'node_modules\n');
    symlinkSync(join(ROOT, 'node_modules'), join(d, 'node_modules'), 'dir');
    git('init', '-q', '-b', 'main'); git('add', '-A'); git('commit', '-q', '-m', 'base');
    const status = (out: string) => spawnSync(process.execPath, [join(ROOT, 'node_modules/@changesets/cli/bin.js'), 'status', '--since=main', `--output=${out}`], { cwd: d, env, encoding: 'utf8', timeout: 60_000 });
    return { d, git, status };
  }

  it('changeset status passes on a PR bumping one package, and the fixed group bumps all @centcom/* together (acceptance 6)', () => {
    const { d, git, status } = workspaceRepo();
    git('checkout', '-q', '-b', 'pr');
    mkdirSync(join(d, 'packages/protocol/src'), { recursive: true });
    writeFileSync(join(d, 'packages/protocol/src/feature.ts'), 'export const feature = 1;\n');
    writeFileSync(join(d, '.changeset/brave-fox.md'), '---\n"@centcom/protocol": minor\n---\n\nAdd a feature.\n');
    git('add', '-A'); git('commit', '-q', '-m', 'feature');
    const r = status('plan.json');
    expect(r.status, r.stderr + r.stdout).toBe(0);
    const plan = JSON.parse(readFileSync(join(d, 'plan.json'), 'utf8')) as { releases: { name: string; newVersion: string; oldVersion: string }[] };
    const names = workspaceManifests().map((f) => JSON.parse(readFileSync(join(ROOT, f), 'utf8')).name as string).filter((n) => n.startsWith('@centcom/')).sort();
    expect(names.length).toBeGreaterThan(1);
    expect(plan.releases.map((x) => x.name).sort()).toEqual(names);
    const versions = new Set(plan.releases.map((x) => x.newVersion));
    expect(versions.size).toBe(1);
    const [next] = [...versions];
    expect(next).not.toBe(plan.releases[0]!.oldVersion);
  }, 90_000);

  it('changeset status fails on a PR that changes a package without a changeset', () => {
    const { d, git, status } = workspaceRepo();
    git('checkout', '-q', '-b', 'pr');
    mkdirSync(join(d, 'packages/net/src'), { recursive: true });
    writeFileSync(join(d, 'packages/net/src/change.ts'), 'export const change = 1;\n');
    git('add', '-A'); git('commit', '-q', '-m', 'change');
    expect(status('plan.json').status).toBe(1);
  }, 90_000);
});
