import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SCRIPT = fileURLToPath(new URL('../../packaging/install.sh', import.meta.url));
const b64url = (b: Buffer): string => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const keys = () => { const k = generateKeyPairSync('ed25519'); return { priv: k.privateKey, pubPem: k.publicKey.export({ type: 'spki', format: 'pem' }).toString() }; };

/** A signed fake release in a folder: archive, SHA256SUMS and the .sig that tools/release/sign.mjs would write (Ed25519 over the 32 raw digest bytes). */
function release(o: { version?: string; target?: string } = {}) {
  const version = o.version ?? '9.9.9'; const target = o.target ?? 'linux-x64'; const root = mkdtempSync(join(tmpdir(), 'cc-inst-')); const rel = join(root, 'rel'); const src = join(root, 'src'); mkdirSync(rel); mkdirSync(src);
  writeFileSync(join(src, 'centcom'), '#!/bin/sh\necho centcom-test-build\n', { mode: 0o755 }); const name = `centcom-${version}-${target}.tar.gz`;
  execFileSync('tar', ['-czf', join(rel, name), '-C', src, 'centcom']); const k = keys();
  const digest = createHash('sha256').update(readFileSync(join(rel, name))).digest();
  writeFileSync(join(rel, 'SHA256SUMS'), `${digest.toString('hex')}  ${name}\n`); writeFileSync(join(rel, `${name}.sig`), b64url(sign(null, digest, k.priv)));
  writeFileSync(join(root, 'pub.pem'), k.pubPem);
  return { root, rel, name, version, target, pub: join(root, 'pub.pem'), out: join(root, 'bin'), tmp: join(root, 'tmp'), k };
}
function install(r: ReturnType<typeof release>, extra: string[] = [], env: Record<string, string> = {}) {
  mkdirSync(r.tmp, { recursive: true });
  return spawnSync('sh', [SCRIPT, '--version', r.version, '--base-url', `file://${r.rel}`, '--target', r.target, '--pubkey-file', r.pub, '--dir', r.out, ...extra], { encoding: 'utf8', env: { ...process.env, HOME: r.root, TMPDIR: r.tmp, CENTCOM_INSTALL_WAITS: '0 0 0', ...env } });
}
/** After a refusal: nothing in the install folder, no half-written file, no temporary files left. */
const leftNothing = (r: ReturnType<typeof release>): void => { expect(existsSync(r.out) ? readdirSync(r.out) : []).toEqual([]); expect(readdirSync(r.tmp)).toEqual([]); };

describe('install.sh proves a download before it installs anything', () => {
  it('a good release is installed, runs, and leaves no temporary files', () => {
    const r = release(); const p = install(r); expect(p.status).toBe(0); expect(p.stdout).toContain(`Installed centcom 9.9.9 to ${r.out}`);
    expect(execFileSync(join(r.out, 'centcom'), { encoding: 'utf8' }).trim()).toBe('centcom-test-build'); expect(readdirSync(r.out)).toEqual(['centcom']); expect(readdirSync(r.tmp)).toEqual([]);
  });
  it('a tampered archive is refused, with nothing installed', () => {
    const r = release(); const f = join(r.rel, r.name); const b = readFileSync(f); b[b.length - 9] = b[b.length - 9]! ^ 0xff; writeFileSync(f, b);
    const p = install(r); expect(p.status).not.toBe(0); expect(p.stderr).toMatch(/checksum differs/); leftNothing(r);
  });
  it('a truncated archive is refused', () => { const r = release(); const f = join(r.rel, r.name); writeFileSync(f, readFileSync(f).subarray(0, 40)); const p = install(r); expect(p.status).not.toBe(0); expect(p.stderr).toMatch(/checksum differs/); leftNothing(r); });
  it('SHA256SUMS that agrees with a swapped archive does not help: the signature is still checked', () => {
    const r = release(); const f = join(r.rel, r.name); const src = join(r.root, 'evil'); mkdirSync(src); writeFileSync(join(src, 'centcom'), '#!/bin/sh\necho evil\n', { mode: 0o755 }); execFileSync('tar', ['-czf', f, '-C', src, 'centcom']);
    writeFileSync(join(r.rel, 'SHA256SUMS'), `${createHash('sha256').update(readFileSync(f)).digest('hex')}  ${r.name}\n`); // the attacker fixed the sums but cannot sign
    const p = install(r); expect(p.status).not.toBe(0); expect(p.stderr).toMatch(/not signed by a key Centcom trusts/); leftNothing(r);
  });
  it('a signature from another key is refused; so is a garbled or short one', () => {
    const r = release(); const other = keys(); const digest = createHash('sha256').update(readFileSync(join(r.rel, r.name))).digest(); writeFileSync(join(r.rel, `${r.name}.sig`), b64url(sign(null, digest, other.priv)));
    expect(install(r).stderr).toMatch(/not signed by a key Centcom trusts/); leftNothing(r);
    writeFileSync(join(r.rel, `${r.name}.sig`), 'AAAA'); expect(install(r).stderr).toMatch(/signature is not the right size/); leftNothing(r);
    writeFileSync(join(r.rel, `${r.name}.sig`), '%%%%'); expect(install(r).status).not.toBe(0); leftNothing(r);
  });
  it('a missing SHA256SUMS or signature, or a listing without this file, stops it', () => {
    const r = release(); writeFileSync(join(r.rel, 'SHA256SUMS'), `${'0'.repeat(64)}  something-else.tar.gz\n`); expect(install(r).stderr).toMatch(/does not list this download/); leftNothing(r);
    const a = release(); execFileSync('rm', [join(a.rel, 'SHA256SUMS')]); expect(install(a).stderr).toMatch(/could not download SHA256SUMS/); leftNothing(a);
    const b = release(); execFileSync('rm', [join(b.rel, `${b.name}.sig`)]); expect(install(b).stderr).toMatch(/could not download the signature/); leftNothing(b);
  });
  it('without a key it refuses (the real installer has none until the signing procedure exists); an unsupported computer lists the supported ones', () => {
    const r = release(); mkdirSync(r.tmp, { recursive: true });
    const p = spawnSync('sh', [SCRIPT, '--version', r.version, '--base-url', `file://${r.rel}`, '--target', r.target, '--dir', r.out], { encoding: 'utf8', env: { ...process.env, HOME: r.root, TMPDIR: r.tmp } }); expect(p.status).toBe(1); expect(p.stderr).toMatch(/no release signing key is built into this installer yet/); leftNothing(r);
    const u = install(r, ['--target', 'plan9-mips']); expect(u.status).toBe(1); expect(u.stderr).toContain('linux-x64 linux-arm64 darwin-x64 darwin-arm64 win32-x64');
  });
  it('options are checked; the shell startup files are left alone unless --modify-path is given', () => {
    const r = release(); expect(spawnSync('sh', [SCRIPT, '--bogus'], { encoding: 'utf8' }).status).toBe(2); expect(spawnSync('sh', [SCRIPT, '--version', '1;rm -rf /', '--target', 'linux-x64'], { encoding: 'utf8' }).status).toBe(2); // a bad target or version is refused before anything runs
    const p = install(r, [], { PATH: '/usr/bin:/bin' }); expect(p.status).toBe(0); expect(p.stdout).toContain('Add '); expect(existsSync(join(r.root, '.profile'))).toBe(false);
    const q = release(); expect(install(q, ['--modify-path'], { PATH: '/usr/bin:/bin' }).status).toBe(0); expect(readFileSync(join(q.root, '.profile'), 'utf8')).toContain(`export PATH="${q.out}:$PATH"`);
  });
});
