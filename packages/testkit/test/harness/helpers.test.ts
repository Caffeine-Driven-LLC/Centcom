import dns from 'node:dns';
import net from 'node:net';
import tls from 'node:tls';
import { existsSync } from 'node:fs';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { fakeClock, fixedIds, loadContractFixture, memFs, openTmpDirs, seededRng, tmpDir } from '../../src/index.js';
import { NETWORK_BLOCKED, allowConsole, defineCentcomConfig, installConsoleGuard, installNetworkGuard, isLoopback } from '../../src/vitest/index.js';

installNetworkGuard();
describe('network guard (acceptance 1)', () => {
  it('a connection to a real host fails with the blocked message and names the test; loopback works', async () => {
    const err = await new Promise<Error>((res) => { const s = net.connect({ host: 'example.com', port: 443 }); s.once('error', res); });
    expect(err.message).toContain(NETWORK_BLOCKED); expect(err.message).toContain('example.com'); expect(err.message).toContain('network access blocked in tests'); expect(err.message).toContain('test:');
    const srv = net.createServer((s) => s.end('hi')); await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r())); const port = (srv.address() as net.AddressInfo).port;
    const got = await new Promise<string>((res, rej) => { const c = net.connect({ host: '127.0.0.1', port }); let d = ''; c.on('data', (x) => (d += x)); c.on('end', () => res(d)); c.on('error', rej); }); expect(got).toBe('hi'); await new Promise((r) => srv.close(r));
  });
  it('tls.connect and dns.lookup to real hosts are refused; loopback names resolve', async () => {
    expect(() => tls.connect({ host: 'example.com', port: 443 })).toThrow(NETWORK_BLOCKED); await expect(new Promise((res, rej) => dns.lookup('example.com', (e, a) => (e ? rej(e) : res(a))))).rejects.toThrow(NETWORK_BLOCKED);
    const a = await new Promise<string>((res, rej) => dns.lookup('localhost', (e, addr) => (e ? rej(e) : res(String(addr))))); expect(a).toMatch(/127\.0\.0\.1|::1/);
    expect(isLoopback('127.0.0.1') && isLoopback('::1') && isLoopback('[::1]') && isLoopback('foo.localhost') && !isLoopback('10.0.0.1') && !isLoopback('example.com') && !isLoopback('127.0.0.1.evil.com')).toBe(true);
  });
  it('a request by name with fetch is blocked too', async () => { await expect(fetch('https://example.com/')).rejects.toThrow(); });
});

describe('console guard', () => {
  it('library output fails the test unless allowed', () => {
    installConsoleGuard(); expect(() => console.log('noise')).toThrow(/console\.log was called/); expect(() => console.error('noise')).toThrow(); let ran = false; allowConsole(() => { ran = true; }); expect(ran).toBe(true);
  });
});

describe('fakeClock (acceptance 2)', () => {
  it('advance(1000) fires a 999 ms timer once and a 1001 ms timer not at all', async () => {
    const c = fakeClock(0); let a = 0; let b = 0; c.setTimeout(() => a++, 999); c.setTimeout(() => b++, 1001); await c.advance(1000); expect([a, b]).toEqual([1, 0]); expect(c.now()).toBe(1000); await c.advance(1); expect(b).toBe(1);
  });
  it('property: two runs over 200 random timers fire in the same order, which is by due time then creation', async () => {
    await fc.assert(fc.asyncProperty(fc.array(fc.integer({ min: 0, max: 5000 }), { minLength: 1, maxLength: 200 }), async (delays) => {
      const run = async () => { const c = fakeClock(0); const fired: number[] = []; delays.forEach((d, i) => c.setTimeout(() => fired.push(i), d)); await c.advance(6000); return fired; };
      const x = await run(); const y = await run(); const expected = delays.map((d, i) => [d, i] as const).sort((p, q) => p[0] - q[0] || p[1] - q[1]).map((p) => p[1]); return JSON.stringify(x) === JSON.stringify(y) && JSON.stringify(x) === JSON.stringify(expected);
    }), { numRuns: 200, seed: 7 });
  }, 60_000);
  it('a cleared timer does not fire; intervals repeat; set() moves forward only', async () => {
    const c = fakeClock(100); let n = 0; const h = c.setTimeout(() => n++, 10); c.clearTimeout(h); let k = 0; c.setInterval(() => k++, 10); await c.advance(35); expect([n, k]).toEqual([0, 3]); expect(() => c.set(0)).toThrow(RangeError);
  });
});

describe('seededRng and fixedIds', () => {
  it('the same seed gives the same sequence in [0, 1); different seeds differ; the spread looks uniform', () => {
    const a = seededRng(42); const b = seededRng(42); const xs = Array.from({ length: 1000 }, () => a()); expect(xs).toEqual(Array.from({ length: 1000 }, () => b())); expect(xs.every((x) => x >= 0 && x < 1)).toBe(true); expect(seededRng(43)()).not.toBe(xs[0]);
    const mean = xs.reduce((s, x) => s + x, 0) / xs.length; expect(mean).toBeGreaterThan(0.45); expect(mean).toBeLessThan(0.55); const buckets = new Array(10).fill(0); for (const x of xs) buckets[Math.floor(x * 10)]++; expect(Math.min(...buckets)).toBeGreaterThan(60);
  });
  it('fixed ids are valid CT-IDS ids, repeat for the same seed and increase', () => {
    const a = fixedIds(5); const b = fixedIds(5); const ids = [a.next('ses'), a.next('ses'), a.next('msg')]; expect(ids).toEqual([b.next('ses'), b.next('ses'), b.next('msg')]); for (const id of ids) expect(id).toMatch(/^[a-z]{3}_[0-9A-HJKMNP-TV-Z]{26}$/); expect(ids[0]! < ids[1]!.replace('msg', 'ses')).toBe(true); expect(fixedIds(6).next('ses')).not.toBe(ids[0]);
  });
});

describe('tmpDir and memFs and fixtures', () => {
  it('a tmp dir exists until disposed, then is gone', async () => { const t = await tmpDir(); expect(existsSync(t.path)).toBe(true); expect(openTmpDirs()).toContain(t.path); await t.dispose(); expect(existsSync(t.path)).toBe(false); expect(openTmpDirs()).not.toContain(t.path); });
  it('memFs reads, writes, appends, lists, renames, removes and reports ENOENT like the real one', async () => {
    const fs = memFs({ '/a/b.txt': 'one' }); expect(await fs.readText('/a/b.txt')).toBe('one'); await fs.writeFile('/a/c/d.txt', 'two'); await fs.appendFile('/a/c/d.txt', '+more'); expect(await fs.readText('/a/c/d.txt')).toBe('two+more'); expect(await fs.readdir('/a')).toEqual(['b.txt', 'c']);
    expect((await fs.stat('/a/b.txt')).size).toBe(3); expect((await fs.stat('/a/c')).isDirectory).toBe(true); await fs.rename('/a/b.txt', '/a/e.txt'); expect(await fs.exists('/a/b.txt')).toBe(false); await expect(fs.readText('/nope')).rejects.toMatchObject({ code: 'ENOENT' });
    await fs.rm('/a', { recursive: true }); expect(fs.files()).toEqual({}); await expect(fs.rm('/a')).rejects.toMatchObject({ code: 'ENOENT' }); await fs.rm('/a', { force: true }); await expect(fs.readText('/x/../../etc')).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('contract fixtures load by relative path and cannot escape the folder', () => { expect((loadContractFixture('lan/pair1.json') as { schema: string }).schema).toBe('lan-pair.schema.json'); expect(() => loadContractFixture('../package.json')).toThrow(/cannot leave/); expect(() => loadContractFixture('/etc/passwd')).toThrow(); });
});

describe('vitest preset (acceptance 6)', () => {
  it('has the agreed limits, forks, v8 coverage with an 80 floor, and merges overrides', () => {
    const c = defineCentcomConfig({ test: { testTimeout: 1234 } }); expect(c.test).toMatchObject({ environment: 'node', hookTimeout: 10_000, testTimeout: 1234, retry: 0, pool: 'forks' }); expect(c.test!.coverage).toMatchObject({ provider: 'v8', thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 } }); expect(c.test!.env).toMatchObject({ TZ: 'UTC', LANG: 'en_US.UTF-8' }); expect((c.test!.setupFiles as string[])[0]).toMatch(/setup\.ts$/);
  });
});
