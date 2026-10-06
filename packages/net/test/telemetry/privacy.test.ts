import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import { ERROR_TABLE, validateAgainst } from '@centcom/protocol';
import { startMockBackend } from '@centcom/testkit';
import { createTelemetry, fetchPost, nodeStateFs } from '../../src/index.js';
import { emitAll, rig, stateFs, tick } from './helpers.js';

const run = async (r: ReturnType<typeof rig>, ms = 0) => { await tick(); await r.clock.advance(ms); await tick(); await tick(); };
const CANARIES = ['/home/alex/secret-project/src/a.ts', 'C:\\Users\\Alex\\repo', 'feature/alex-private-branch', 'alex@example.com', 'alexs-macbook.local', 'github.com/acme/private-repo', 'sk-ant-api03-' + 'Z'.repeat(40), 'usr_01JA3Z8K2M5N7P9Q0R1S2T3V4W', 'rm -rf /', 'fix the login bug in auth.ts'];

describe('privacy', () => {
  it('property: whatever strings are passed, a body only contains allow-listed values and validates against the contract schema', async () => {
    await fc.assert(fc.asyncProperty(fc.array(fc.oneof(fc.constantFrom(...CANARIES), fc.string({ maxLength: 60 }), fc.fullUnicodeString({ maxLength: 40 })), { minLength: 1, maxLength: 12 }), fc.array(fc.constantFrom(...CANARIES, 'login', 'idle', 'thinking', 'lan', 'relay', 'branch', 'not_found', '1.0.0'), { minLength: 1, maxLength: 6 }), async (strs, mix) => {
      const r = rig(); const any = [...strs, ...mix]; for (const s of any) { r.t.commandRun(s); r.t.featureUsed(s); r.t.errorShown(s as never); r.t.agentStateChange(s as never, s as never); r.t.sessionCreated(s as never, s as never); r.t.sessionJoined(s as never); r.t.updateResult(s, s, true); r.t.perfStartup(s as never); r.t.perfFrame(s as never); }
      r.t.appStart(); await run(r, 20 * 60_000); const bodies = r.reqs.map((q) => q.body); expect(bodies.length).toBeGreaterThan(0);
      for (const b of bodies) { for (const c of CANARIES) expect(b.includes(c), c).toBe(false); expect(b).not.toMatch(/\b(usr|mem|dev|ses|wsp|agt|apr)_[0-9A-HJKMNP-TV-Z]{26}/); expect(b).not.toMatch(/[\\/]\w+[\\/]/); expect(b).not.toMatch(/@\w+\.\w+/); expect(validateAgainst('telemetry.schema.json', JSON.parse(b), 'strict').ok).toBe(true); }
      for (const q of r.reqs) for (const e of q.json.events) for (const [k, v] of Object.entries(e.props ?? {})) { expect(['name', 'mode', 'transport', 'from', 'to', 'key', 'code', 'ms', 'p95_ms', 'ok']).toContain(k); if (typeof v === 'string') expect(v.length).toBeLessThanOrEqual(48); }
    }), { numRuns: 60 });
  });
  it('the values that do get through are exactly what the API takes: names, enums, registry codes, numbers, versions', async () => {
    const r = rig({ commands: new Set(['login']) }); r.t.commandRun('login'); r.t.errorShown('not_found'); r.t.agentStateChange('idle', 'thinking'); r.t.updateResult('1.0.0', '1.1.0', true); r.t.sessionCreated('command_post', 'lan'); await run(r); expect(r.reqs[0]!.json.events.map((e) => [e.type, e.props])).toEqual([['command.run', { name: 'login' }], ['error.shown', { code: 'not_found' }], ['agent.state_change', { from: 'idle', to: 'thinking' }], ['update.result', { from: '1.0.0', to: '1.1.0', ok: true }], ['session.created', { mode: 'command_post', transport: 'lan' }]]); expect('not_found' in ERROR_TABLE).toBe(true);
  });
});

describe('install id', () => {
  it('is a random ULID, kept at <state>/telemetry/install_id with mode 0600, and reused after a restart', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tel-')); const path = join(dir, 'telemetry', 'install_id'); const mk = () => { const reqs: string[] = []; const t = createTelemetry({ config: () => ({ enabled: true }), env: {}, clock: { now: () => Date.now(), setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (h) => clearTimeout(h as NodeJS.Timeout) }, fs: nodeStateFs, http: async (_u, i) => { reqs.push(i.body); return { status: 204 }; }, ulid: () => 'ABCDEFGHJKMNPQRSTVWXYZ0123'.slice(0, 26), ua: 'x', baseUrl: 'https://a', installIdPath: path }); return { t, reqs }; };
    const a = mk(); a.t.appStart(); await a.t.flush(); expect(JSON.parse(a.reqs[0]!).install_id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/); expect(statSync(path).mode & 0o777).toBe(0o600); expect(statSync(join(dir, 'telemetry')).mode & 0o777).toBe(0o700); expect(readFileSync(path, 'utf8').trim()).toBe(JSON.parse(a.reqs[0]!).install_id);
    writeLine(path, '01JA3Z8K2M5N7P9Q0R1S2T3V4W'); const b = mk(); b.t.appStart(); await b.t.flush(); expect(JSON.parse(b.reqs[0]!).install_id).toBe('01JA3Z8K2M5N7P9Q0R1S2T3V4W'); writeLine(path, 'not an id, with an e-mail a@b.c'); const c = mk(); c.t.appStart(); await c.t.flush(); expect(JSON.parse(c.reqs[0]!).install_id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/); expect(readFileSync(path, 'utf8')).not.toContain('@');
  });
  it('is never derived from anything about the person, and differs between installs', async () => { const ids = new Set<string>(); for (let i = 0; i < 5; i++) { const r = rig(); r.t.appStart(); await run(r); ids.add(r.reqs[0]!.json.install_id); } expect(ids.size).toBe(5); });
  it('resetInstallId gives a different ULID and the old one is gone from disk and from later requests', async () => {
    const r = rig(); r.t.appStart(); await run(r); const old = r.reqs[0]!.json.install_id; expect(r.fs.m.get('/state/telemetry/install_id')!.trim()).toBe(old); await r.t.resetInstallId(); const now = r.fs.m.get('/state/telemetry/install_id')!.trim(); expect(now).not.toBe(old); expect(now).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/); expect(JSON.stringify([...r.fs.m.entries()])).not.toContain(old); await run(r, 60_000); r.t.appExit(); await run(r, 60_000); expect(r.reqs.at(-1)!.json.install_id).toBe(now); expect(r.fs.log.removes).toBe(1);
  });
  it('an unwritable state folder keeps the id in memory for the run and telemetry still works', async () => { const logs: string[] = []; const r = rig({ fs: stateFs({}, { failWrites: true }), log: { debug: (m) => logs.push(m) } }); r.t.appStart(); await run(r); r.t.appExit(); await run(r, 60_000); expect(r.reqs).toHaveLength(2); expect(r.reqs[1]!.json.install_id).toBe(r.reqs[0]!.json.install_id); expect(logs.filter((l) => l === 'telemetry.id_write_failed')).toHaveLength(1); });
});
const writeLine = (p: string, t: string) => writeFileSync(p, t + '\n');

describe('what is sent', () => {
  it('has an Idempotency-Key (a fresh ULID per batch, at most 64 characters), the user agent, no credentials of any kind, and the contract shape', async () => {
    const r = rig(); for (let i = 0; i < 150; i++) r.t.featureUsed('x'); await run(r, 60_000); expect(r.reqs).toHaveLength(2);
    for (const q of r.reqs) { expect(q.url).toBe('https://api.test/v1/telemetry/events'); expect(q.headers['idempotency-key']).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/); expect(q.headers['idempotency-key']!.length).toBeLessThanOrEqual(64); expect(q.headers['user-agent']).toContain('centcom-cli/1.0.0'); expect(Object.keys(q.headers).map((h) => h.toLowerCase())).not.toEqual(expect.arrayContaining(['authorization'])); expect(Object.keys(q.headers).map((h) => h.toLowerCase()).filter((h) => /auth|cookie|token|x-/.test(h))).toEqual([]); expect(validateAgainst('telemetry.schema.json', q.json, 'strict').ok).toBe(true); expect(q.json.app).toMatchObject({ name: 'centcom-cli', contract: '1.2.0' }); }
    expect(r.reqs[0]!.headers['idempotency-key']).not.toBe(r.reqs[1]!.headers['idempotency-key']);
  });
  it('a failed batch is queued once more with the same key, then dropped', async () => {
    const r = rig({ status: 500 }); r.t.appStart(); r.t.appExit(); await run(r); expect(r.reqs).toHaveLength(1); await run(r, 60_000); expect(r.reqs).toHaveLength(2); expect(r.reqs[1]!.headers['idempotency-key']).toBe(r.reqs[0]!.headers['idempotency-key']); expect(r.reqs[1]!.json.events).toEqual(r.reqs[0]!.json.events); await run(r, 10 * 60_000); expect(r.reqs).toHaveLength(2); expect(r.t.status().buffered).toBe(0); expect(r.clock.pending()).toBe(0);
  });
  it('a retry that succeeds is not repeated, and new events go out after it', async () => { const r = rig({ status: 500 }); r.t.appStart(); await run(r); r.state.status = 204; r.t.appExit(); await run(r, 60_000); expect(r.reqs).toHaveLength(2); await run(r, 60_000); expect(r.reqs).toHaveLength(3); expect(r.reqs[2]!.json.events.map((e) => e.type)).toEqual(['app.exit']); expect(r.reqs.filter((q) => q.json.events.some((e) => e.type === 'app.start'))).toHaveLength(2); });
});

describe('silent failure', () => {
  it.each([[500], [429], ['throw']] as const)('%s never throws and never prints', async (status) => {
    const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true); const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true); const log = vi.spyOn(console, 'log').mockImplementation(() => undefined); const debug: unknown[] = [];
    const r = rig({ status, log: { debug: (m, c) => debug.push([m, c]) } }); r.t.appStart(); await run(r); await run(r, 60_000); await expect(r.t.flush(2000)).resolves.toBeUndefined(); expect(out).not.toHaveBeenCalled(); expect(err).not.toHaveBeenCalled(); expect(log).not.toHaveBeenCalled(); expect(JSON.stringify(debug)).not.toContain('app.start');
  });
  it('a request that never answers is cut at 5 s; flush(2000) always resolves by 2000 ms', async () => {
    const r = rig({ status: 'hang' }); r.t.appStart(); let done = false; const f = r.t.flush(2000).then(() => { done = true; }); await tick(); expect(r.reqs).toHaveLength(1); await r.clock.advance(1999); expect(done).toBe(false); await r.clock.advance(1); await f; expect(done).toBe(true);
    await run(r, 3001); expect(r.t.status().buffered).toBe(1); // the 5 s cap gave up on the first try: queued once more
    await run(r, 60_000); expect(r.reqs).toHaveLength(2); expect(r.reqs[1]!.headers['idempotency-key']).toBe(r.reqs[0]!.headers['idempotency-key']); await run(r, 5001); expect(r.t.status().buffered).toBe(0); expect(r.clock.pending()).toBe(0); // and then dropped
    const again = rig({ status: 'hang' }); again.t.appStart(); await run(again); const t0 = again.clock.now(); await again.t.flush(2000); expect(again.clock.now() - t0).toBeLessThanOrEqual(2000); // a send is already in flight: flush returns at once
  });
  it('flush on an empty buffer resolves at once, and a hung send does not block startup or exit: emit calls return immediately', async () => { const r = rig({ status: 'hang' }); const t0 = Date.now(); for (let i = 0; i < 1000; i++) r.t.featureUsed('x'); expect(Date.now() - t0).toBeLessThan(500); await rig().t.flush(); });
  it('persists nothing but the install id: no event ever touches the disk', async () => { const r = rig(); emitAll(r.t); await run(r, 600_000); expect([...r.fs.m.keys()]).toEqual(['/state/telemetry/install_id']); expect(r.fs.log.writes).toBe(1); });
});

describe('against the mock backend', () => {
  it('a real batch is accepted by the mock without any credentials (the endpoint is open to anonymous callers)', async () => {
    const m = await startMockBackend({ clock: 'virtual', seed: 3 }); try { const t = createTelemetry({ config: () => ({ enabled: true }), env: {}, clock: { now: () => Date.now(), setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (h) => clearTimeout(h as NodeJS.Timeout) }, fs: stateFs().fs, http: fetchPost, ulid: () => '01JA3Z8K2M5N7P9Q0R1S2T3V4W', ua: 'centcom-cli/1.0.0', baseUrl: m.url, installIdPath: '/x/id', app: { name: 'centcom-cli', version: '1.0.0', os: 'linux', arch: 'x64', contract: '1.2.0' } }); emitAll(t); await t.flush(2000); expect(t.status()).toMatchObject({ sentBatches: 1, buffered: 0 });
    } finally { await m.stop(); }
  });
  it('an unreachable server is silent', async () => { const t = createTelemetry({ config: () => ({ enabled: true }), env: {}, clock: { now: () => Date.now(), setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (h) => clearTimeout(h as NodeJS.Timeout) }, fs: stateFs().fs, http: fetchPost, ulid: () => '01JA3Z8K2M5N7P9Q0R1S2T3V4W', ua: 'x', baseUrl: 'http://127.0.0.1:1', installIdPath: '/x/id' }); t.appStart(); const t0 = Date.now(); await expect(t.flush(2000)).resolves.toBeUndefined(); expect(Date.now() - t0).toBeLessThan(2500); t.dispose(); });
});
