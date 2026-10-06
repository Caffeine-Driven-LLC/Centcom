import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { normaliseManifest, HashMismatchError, ManagedInstallError, NotVerifiedError, SignatureError, TooLargeError, UpdateClient, UpdateError, backgroundCheck, compareVersions, createHttpClient, detectInstallMethod, downloadArtifact, initCrypto, isPrerelease, shouldCheck, sodium, verifyArtifact, type Channel, type ReleaseKeySet, type ReleaseManifest } from '../../src/index.js';
import { AutoClock, NO_TIMEOUT, UA, scriptedFetch } from '../http/helpers.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'cc-upd-')); const sha = (b: Buffer) => createHash('sha256').update(b).digest();
await initCrypto(); const kp = sodium().crypto_sign_keypair(); const other = sodium().crypto_sign_keypair();
const b64 = (u: Uint8Array) => Buffer.from(u).toString('base64url'); const KEYS: ReleaseKeySet = { keys: [{ id: 'k1', publicKey: b64(kp.publicKey) }] };
const sign = (digest: Uint8Array, sk = kp.privateKey) => b64(sodium().crypto_sign_detached(digest, sk));

/** A static server for artifacts: Range, a cut-off after N bytes, and extra bytes. */
function artifactServer(body: Buffer, o: { cutAt?: () => number | undefined; extra?: number } = {}) {
  const seen: { range?: string }[] = [];
  const srv: Server = createServer((req, res) => {
    seen.push({ range: req.headers.range }); const m = /bytes=(\d+)-/.exec(req.headers.range ?? ''); const from = m ? Number(m[1]) : 0; const data = Buffer.concat([body, Buffer.alloc(o.extra ?? 0, 1)]).subarray(from);
    res.writeHead(m ? 206 : 200, { 'content-length': data.length, ...(m ? { 'content-range': `bytes ${from}-${body.length - 1}/${body.length}` } : {}) }); const cut = o.cutAt?.();
    if (cut !== undefined && cut < data.length) { res.write(data.subarray(0, cut)); setTimeout(() => res.destroy(), 20); return; } res.end(data);
  });
  return new Promise<{ url: string; seen: typeof seen; close(): Promise<void> }>((ok) => srv.listen(0, '127.0.0.1', () => { const a = srv.address() as { port: number }; ok({ url: `http://127.0.0.1:${a.port}/a.bin`, seen, close: () => new Promise((r) => { srv.closeAllConnections?.(); srv.close(() => r()); }) }); }));
}
/** The manifest as the REST contract (OpenAPI) spells it. */
const manifest = (o: Partial<{ channel: Channel; version: string; min_supported_version: string; body: Buffer; url: string; sk: Uint8Array; platform: string }> = {}) => { const body = o.body ?? Buffer.from('new program'); return { channel: o.channel ?? 'stable', version: o.version ?? '1.1.0', released_at: '2026-10-06T00:00:00.000Z', min_supported_version: o.min_supported_version ?? '1.0.0', artifacts: [{ platform: o.platform ?? 'linux', arch: 'x64', kind: 'binary', url: o.url ?? 'http://127.0.0.1:1/a.bin', sha256: `sha256:${sha(body).toString('hex')}`, size: body.length, signature: sign(sha(body), o.sk) }] }; };
function clientFor(m: ReturnType<typeof manifest>, o: { current?: string; channel?: Channel; dir?: string; platform?: NodeJS.Platform; method?: { isSea?: boolean; scriptPath?: string } } = {}) {
  const dir = o.dir ?? tmp(); const sf = scriptedFetch([() => new Response(JSON.stringify(m), { status: 200, headers: { 'content-type': 'application/json' } })]);
  const http = createHttpClient({ baseUrl: 'https://api.centcom.dev', getAccessToken: async () => undefined, userAgent: UA, fetch: sf.fetch, clock: new AutoClock(), timeoutMs: NO_TIMEOUT });
  writeFileSync(join(dir, 'centcom'), 'old program'); chmodSync(join(dir, 'centcom'), 0o755);
  return { dir, sf, c: new UpdateClient({ http, currentVersion: o.current ?? '1.0.0', platform: o.platform ?? 'linux', arch: 'x64', channel: o.channel ?? 'stable', keys: KEYS, installDir: dir, install: { execPath: join(dir, 'centcom'), isSea: o.method?.isSea ?? true, scriptPath: o.method?.scriptPath } }) };
}
const open: { close(): Promise<void> }[] = []; afterEach(async () => { while (open.length) await open.pop()!.close(); });

describe('manifest spellings', () => { it('the REST form and the JSON-schema form read the same', () => { const a = normaliseManifest(manifest({ platform: 'macos' })); const b = normaliseManifest({ channel: 'stable', version: '1.1.0', released_at: 'x', min_supported: '1.0.0', artifacts: [{ platform: 'darwin', arch: 'x64', kind: 'binary', url: 'http://127.0.0.1:1/a.bin', sha256: a.artifacts[0]!.sha256, size: a.artifacts[0]!.size, sig: a.artifacts[0]!.sig }] }); expect(a.artifacts[0]!.platform).toBe('darwin'); expect(a.artifacts).toEqual(b.artifacts); expect(a.min_supported).toBe(b.min_supported); expect(normaliseManifest(null as never).artifacts).toEqual([]); }); });
describe('versions', () => { it('compare like semver, with pre-releases older than their release', () => { expect(compareVersions('1.2.0', '1.1.9')).toBeGreaterThan(0); expect(compareVersions('1.0.0', '1.0.0')).toBe(0); expect(compareVersions('1.0.0-beta.2', '1.0.0')).toBeLessThan(0); expect(compareVersions('1.0.0-beta.10', '1.0.0-beta.2')).toBeGreaterThan(0); expect(compareVersions('1.0.0-alpha', '1.0.0-beta')).toBeLessThan(0); expect(compareVersions('x', '1.0.0')).toBeLessThan(0); expect(isPrerelease('1.0.0-rc.1')).toBe(true); expect(isPrerelease('1.0.0')).toBe(false); }); });

describe('check', () => {
  it('a higher version is available; equal or lower is not; a pre-release is ignored on stable; the request carries the channel, platform and arch', async () => {
    const hi = clientFor(manifest({ version: '1.1.0' })); const r = await hi.c.check(); expect(r).toMatchObject({ available: true, version: '1.1.0', channel: 'stable', required: false }); const u = hi.sf.seen[0]!.url; expect(u.pathname).toBe('/v1/releases/stable/latest'); expect([u.searchParams.get('platform'), u.searchParams.get('arch')]).toEqual(['linux', 'x64']);
    expect((await clientFor(manifest({ version: '1.0.0' })).c.check()).available).toBe(false); expect((await clientFor(manifest({ version: '0.9.0' })).c.check()).available).toBe(false); expect((await clientFor(manifest({ version: '1.2.0-beta.1' })).c.check()).available).toBe(false);
    const beta = clientFor(manifest({ version: '1.2.0-beta.1', channel: 'beta' }), { channel: 'beta' }); expect((await beta.c.check()).available).toBe(true); expect(beta.sf.seen[0]!.url.pathname).toBe('/v1/releases/beta/latest'); expect((await clientFor(manifest({ channel: 'beta' }), { channel: 'stable' }).c.check()).available).toBe(false);
    expect(clientFor(manifest(), { platform: 'darwin' }).sf).toBeDefined(); const mac = clientFor(manifest(), { platform: 'darwin' }); await mac.c.check(); expect(mac.sf.seen[0]!.url.searchParams.get('platform')).toBe('macos');
  });
  it('required: this version is below the minimum, or the service said it is too old', async () => { expect((await clientFor(manifest({ min_supported_version: '1.0.5' })).c.check()).required).toBe(true); const c = clientFor(manifest()); c.c.markRequired(); expect((await c.c.check()).required).toBe(true); });
});

describe('verify', () => {
  it('a flipped byte is a hash mismatch, a good hash from an unknown key is a signature error, a good one passes; failures delete the file and leave the program alone', async () => {
    const body = Buffer.from('new program'); const dir = tmp(); const exe = readFileSync(join(clientFor(manifest(), { dir }).dir, 'centcom')); const art = (o: Parameters<typeof manifest>[0] = {}) => { const a = manifest(o).artifacts[0]!; return { sha256: a.sha256.replace('sha256:', ''), sig: a.signature, sig_kid: 'k1' as string | undefined }; };
    const f1 = join(dir, 'a'); writeFileSync(f1, Buffer.from('new progrXm')); await expect(verifyArtifact(f1, art(), KEYS)).rejects.toBeInstanceOf(HashMismatchError);
    const f2 = join(dir, 'b'); writeFileSync(f2, body); await expect(verifyArtifact(f2, art({ sk: other.privateKey }), KEYS)).rejects.toBeInstanceOf(SignatureError); await expect(verifyArtifact(f2, art(), { keys: [] })).rejects.toBeInstanceOf(SignatureError); await expect(verifyArtifact(f2, { ...art(), sig: 'AAAA' }, KEYS)).rejects.toBeInstanceOf(SignatureError); await verifyArtifact(f2, art(), KEYS);
    await expect(verifyArtifact(f2, { ...art(), sig_kid: 'nope' }, KEYS)).rejects.toBeInstanceOf(SignatureError); await verifyArtifact(f2, { ...art(), sig_kid: undefined }, { keys: [{ id: 'old', publicKey: b64(other.publicKey) }, ...KEYS.keys] }); /* two keys can be valid at once */
    const srv = await artifactServer(Buffer.from('new progrXm')); open.push(srv); const t = clientFor(manifest({ url: srv.url, body }), { dir }); const s = await t.c.download(); await expect(t.c.verify(s)).rejects.toBeInstanceOf(HashMismatchError); expect(existsSync(s.path)).toBe(false); expect(readFileSync(join(dir, 'centcom'))).toEqual(exe);
  });
  it('apply on an unverified update is refused, every time', async () => {
    const body = Buffer.from('new program'); const srv = await artifactServer(body); open.push(srv); const t = clientFor(manifest({ url: srv.url, body })); const s = await t.c.download(); await expect(t.c.apply(s)).rejects.toBeInstanceOf(NotVerifiedError); expect(readFileSync(join(t.dir, 'centcom'), 'utf8')).toBe('old program');
    await t.c.verify(s); const r = await t.c.apply(s); expect(r).toEqual({ restartRequired: true, previous: '1.0.0' }); expect(readFileSync(join(t.dir, 'centcom'), 'utf8')).toBe('new program'); expect(readFileSync(join(t.dir, 'centcom.prev'), 'utf8')).toBe('old program'); expect(readdirSync(t.dir).filter((f) => f.includes('.part'))).toEqual([]);
    await t.c.rollback(); expect(readFileSync(join(t.dir, 'centcom'), 'utf8')).toBe('old program'); await expect(t.c.rollback()).rejects.toMatchObject({ code: 'no_previous' });
  });
});

describe('download', () => {
  it('an interrupted download resumes with a Range request and ends with the whole file; progress is reported', async () => {
    const body = Buffer.from(Array.from({ length: 200_000 }, (_, i) => i % 251)); let cut: number | undefined = 80_000; const srv = await artifactServer(body, { cutAt: () => { const c = cut; cut = undefined; return c; } }); open.push(srv); const dest = join(tmp(), 'x.part'); const prog: number[] = [];
    await expect(downloadArtifact({ url: srv.url, dest, size: body.length, onProgress: (p) => prog.push(p.received) })).rejects.toBeInstanceOf(UpdateError); const part = readFileSync(dest).length; expect(part).toBeGreaterThan(0); expect(part).toBeLessThan(body.length);
    expect(await downloadArtifact({ url: srv.url, dest, size: body.length, onProgress: (p) => prog.push(p.received) })).toBe(body.length); expect(srv.seen[1]!.range).toBe(`bytes=${part}-`); expect(readFileSync(dest)).toEqual(body); expect(prog.at(-1)).toBe(body.length);
  });
  it('a server that sends more than the release says is stopped and the file deleted; a server that ignores Range starts over', async () => {
    const body = Buffer.alloc(50_000, 7); const big = await artifactServer(body, { extra: 10 }); open.push(big); const dest = join(tmp(), 'y.part'); await expect(downloadArtifact({ url: big.url, dest, size: body.length })).rejects.toBeInstanceOf(TooLargeError); expect(existsSync(dest)).toBe(false);
    const plain = createServer((_q, res) => { res.writeHead(200, { 'content-length': body.length }); res.end(body); }); await new Promise<void>((r) => plain.listen(0, '127.0.0.1', () => r())); const port = (plain.address() as { port: number }).port; open.push({ close: () => new Promise((r) => plain.close(() => r())) });
    const d2 = join(tmp(), 'z.part'); writeFileSync(d2, Buffer.alloc(100, 9)); expect(await downloadArtifact({ url: `http://127.0.0.1:${port}/`, dest: d2, size: body.length })).toBe(body.length); expect(readFileSync(d2)).toEqual(body);
  });
  it('a failed request or a missing body is a plain error, never a half file counted as done', async () => { const dest = join(tmp(), 'w.part'); await expect(downloadArtifact({ url: 'http://x/a', dest, size: 10, fetch: (async () => new Response('no', { status: 404 })) as typeof fetch })).rejects.toMatchObject({ code: 'download_failed' }); await expect(downloadArtifact({ url: 'http://x/a', dest, size: 10, fetch: (async () => { throw new Error('offline'); }) as typeof fetch })).rejects.toMatchObject({ code: 'download_failed' }); });
});

describe('how it was installed', () => {
  it('npm and Homebrew installs print the right command and never change the program; a standalone program updates itself', async () => {
    expect(detectInstallMethod({ execPath: '/usr/bin/node', scriptPath: '/usr/lib/node_modules/centcom/bin/c.js' })).toBe('npm'); expect(detectInstallMethod({ execPath: '/opt/homebrew/Cellar/centcom/1/bin/centcom' })).toBe('homebrew'); expect(detectInstallMethod({ execPath: '/x/centcom', isSea: true })).toBe('sea'); expect(detectInstallMethod({ execPath: '/x/node' })).toBe('unknown');
    const t = clientFor(manifest(), { method: { isSea: false, scriptPath: '/usr/lib/node_modules/centcom/bin/c.js' } }); await expect(t.c.download()).rejects.toBeInstanceOf(ManagedInstallError); expect(t.c.method).toBe('npm'); expect(readFileSync(join(t.dir, 'centcom'), 'utf8')).toBe('old program');
  });
});

describe('when to look', () => {
  const day = 24 * 3_600_000;
  it('at most once a day, never when switched off, never in CI', () => {
    expect(shouldCheck({ now: 5 * day, env: {} })).toBe(true); expect(shouldCheck({ now: 5 * day, last: { at: 5 * day - day / 2 }, env: {} })).toBe(false); expect(shouldCheck({ now: 5 * day, last: { at: 4 * day }, env: {} })).toBe(true); expect(shouldCheck({ now: 5 * day, env: { CENTCOM_NO_UPDATE_CHECK: '1' } })).toBe(false); expect(shouldCheck({ now: 5 * day, env: {}, configCheck: false })).toBe(false); expect(shouldCheck({ now: 5 * day, env: { CI: 'true' } })).toBe(false); expect(shouldCheck({ now: 1, last: { at: 1000 }, env: {} })).toBe(true);
  });
  it('the background check says so only when something is newer, saves the time, and never throws', async () => {
    const seen: string[] = []; const saved: number[] = []; await backgroundCheck({ check: async () => ({ available: true, version: '2.0.0' }), save: async (s) => { saved.push(s.at); }, now: () => 7, onAvailable: (v) => seen.push(v) }); expect([seen, saved]).toEqual([['2.0.0'], [7]]);
    await backgroundCheck({ check: async () => ({ available: false }), save: async () => undefined, now: () => 1, onAvailable: (v) => seen.push(v) }); await backgroundCheck({ check: async () => { throw new Error('offline'); }, save: async () => undefined, now: () => 1, onAvailable: (v) => seen.push(v) }); expect(seen).toEqual(['2.0.0']);
  });
});
