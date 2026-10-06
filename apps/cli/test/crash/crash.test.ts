import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { CrashStore, LOG_LINES, MAX_REPORTS, MAX_REPORT_BYTES, buildReport, installCrashHandlers, runCrash, scrubPath, scrubText } from '../../src/crash/index.js';

const T0 = Date.UTC(2026, 9, 6, 12); const dir = () => mkdtempSync(join(tmpdir(), 'cc-crash-'));
const base = { version: '0.1.0', contract: '1.2.0', platform: 'linux-x64', node: 'v22.3.0', now: () => T0, scrub: { home: '/home/alice', deny: ['secret-repo', 'feature/payroll-fix', 'alice'] } };
const files = (d: string) => readdirSync(join(d, 'crashes')).filter((f) => f.endsWith('.json'));

/** Strings that must never reach a report. */
const CORPUS = [
  '/home/alice/secret-repo/src/x.ts', 'file:///home/alice/secret-repo/src/x.ts:10:5', '/home/alice/.ssh/id_ed25519', 'C:\\Users\\alice\\secret-repo\\a.ts', '/Users/alice/Documents/payroll.xlsx', '~/secret-repo/notes.md',
  'cen_live_abcdefghijklmnopqrstuvwxyz0123456789', 'sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAA', 'sk-proj-abcdefghijklmnopqrstuvwxyz012345', 'ghp_abcdefghijklmnopqrstuvwxyz0123456789', 'AKIAABCDEFGHIJKLMNOP', 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz.0123456789.abcdef',
  '{"refresh_token":"abcdefghijklmnopqrstuvwxyz0123456789"}', '{"access_token":"abcdefghijklmnopqrstuvwxyz0123456789"}', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop',
  'feature/payroll-fix', 'branch feature/payroll-fix is dirty', 'git checkout feature/payroll-fix', 'repo secret-repo', 'alice@example.com', 'user alice', 'ses_01JA3Z8K2M5N7P9Q0R1S2T3V4W-secret-repo',
  'QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVowMTIzNDU2Nzg5QUJDREVGR0hJSktMTU5PUFFS', 'base64urlblob_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCdEfGhIj', '/home/alice/secret-repo/.env', '/tmp/alice/secret-repo/build.log', '/home/alice/secret-repo/node_modules/foo/index.js', '/home/alice/work/secret-repo/packages/net/src/a.ts', '/home/alice/Downloads/passwords.txt', 'sk-test-AAAAAAAAAAAAAAAAAAAAAAAAAAAA',
];
const LEAKS = [/alice/, /secret-repo/, /payroll/, /cen_live_/, /sk-ant-/, /sk-proj-/, /ghp_/, /AKIA[0-9A-Z]{16}/, /passwords\.txt/, /refresh_token":"[^[]/, /access_token":"[^[]/, /Bearer [A-Za-z0-9]/, /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, /QUJDREVG/, /base64urlblob/, /id_ed25519/, /payroll\.xlsx/];

describe('redaction', () => {
  it('none of the 30 strings leaks, whether they are in the message, the stack or the log lines', () => {
    expect(CORPUS).toHaveLength(30);
    for (const s of CORPUS) {
      const e = new Error(`failed with ${s}`); e.stack = `Error: failed with ${s}\n    at run (${s}:1:2)\n    at go (/home/alice/secret-repo/src/y.ts:3:4)`; const r = buildReport({ ...base, error: e, log: [`log ${s}`, s] }, 'id'); const text = JSON.stringify(r);
      for (const re of LEAKS) expect(text, `${s} matched ${re}`).not.toMatch(re);
    }
  });
  it('paths shrink to package-relative form; the message keeps its shape', () => { expect(scrubPath('/home/alice/work/app/packages/net/src/a.ts')).toBe('packages/net/src/a.ts'); expect(scrubPath('/x/y/node_modules/foo/index.js')).toBe('node_modules/foo/index.js'); expect(scrubPath('/home/alice/secret-repo/src/x.ts')).toBe('src/x.ts'); expect(scrubPath('/home/alice/.ssh/id_ed25519')).toBe('[path]'); expect(scrubText('Error at /home/alice/secret-repo/src/x.ts:10:5', base.scrub)).toBe('Error at src/x.ts:10:5'); expect(scrubText('at f (/home/alice/work/app/packages/net/src/a.ts:1:2)', base.scrub)).toBe('at f (packages/net/src/a.ts:1:2)'); });
  it('keeps what helps: the version, platform, an error code and a trimmed stack', () => {
    const e = Object.assign(new TypeError('bad input'), { code: 'invalid_request' }); const r = buildReport({ ...base, error: e }, 'x'); expect(r).toMatchObject({ v: 1, version: '0.1.0', contract: '1.2.0', platform: 'linux-x64', node: 'v22.3.0', name: 'TypeError', code: 'invalid_request', message: 'bad input' }); expect(r.stack.length).toBeGreaterThan(0);
    expect(buildReport({ ...base, error: Object.assign(new Error('x'), { code: 'EACCES: /home/alice' }) }, 'y').code).toBeUndefined(); expect(buildReport({ ...base, error: 'a string' }, 'z').name).toBe('Error'); expect(buildReport({ ...base, error: undefined }, 'z').message).toContain('non-error');
  });
  it('a report is at most 64 KiB and keeps the last 50 log lines', () => { const e = new Error('x'.repeat(10_000)); e.stack = ['E', ...Array.from({ length: 500 }, (_, i) => `    at f${i} (/a/b/c/d${i}.ts:1:1)`)].join('\n'); const r = buildReport({ ...base, error: e, log: Array.from({ length: 400 }, (_, i) => `line ${i} ${'y'.repeat(2000)}`) }, 'big'); expect(Buffer.byteLength(JSON.stringify(r))).toBeLessThanOrEqual(MAX_REPORT_BYTES); expect(r.log.length).toBeLessThanOrEqual(LOG_LINES); });
});

describe('retention and files', () => {
  it('never more than 10 files and 640 KiB; the 11th evicts the oldest; mode 0600 in a 0700 folder', () => {
    const d = dir(); const s = new CrashStore(d); let t = T0; const ids: string[] = []; for (let i = 0; i < 11; i++) { t += 1000; ids.push(s.save({ ...base, now: () => t, error: new Error(`crash ${i}`) }).id); }
    expect(files(d)).toHaveLength(MAX_REPORTS); expect(s.read(ids[0]!)).toBeUndefined(); expect(s.read(ids[10]!)?.message).toBe('crash 10'); expect(MAX_REPORTS * MAX_REPORT_BYTES).toBe(640 * 1024); expect(s.list().map((r) => r.message)[0]).toBe('crash 10');
    if (process.platform !== 'win32') { expect(statSync(join(d, 'crashes')).mode & 0o777).toBe(0o700); expect(statSync(join(d, 'crashes', files(d)[0]!)).mode & 0o777).toBe(0o600); }
  });
  it('list, show and delete', () => {
    const d = dir(); const s = new CrashStore(d); const out: string[] = []; const err: string[] = []; const io = { out: (l: string) => out.push(l), err: (l: string) => err.push(l) };
    expect(runCrash(['list'], s, io)).toBe(0); expect(out[0]).toMatch(/No crash reports/); const r = s.save({ ...base, error: new Error('boom') }); out.length = 0; runCrash(['list'], s, io); expect(out[0]).toContain(r.id);
    out.length = 0; expect(runCrash(['show', r.id], s, io)).toBe(0); expect(JSON.parse(out.join('\n')).id).toBe(r.id); expect(runCrash(['show', '../etc/passwd'], s, io)).toBe(1); expect(runCrash(['show'], s, io)).toBe(2);
    expect(runCrash(['delete', r.id], s, io)).toBe(0); expect(files(d)).toHaveLength(0); expect(runCrash(['delete', r.id], s, io)).toBe(1); s.save({ ...base, error: new Error('a') }); s.save({ ...base, error: new Error('b') }); out.length = 0; expect(runCrash(['delete', '--all'], s, io)).toBe(0); expect(out[0]).toBe('Deleted 2 reports.'); expect(runCrash(['nope'], s, io)).toBe(2);
  });
});

describe('no egress', () => {
  it('capturing a crash opens no network connection and calls nothing that could', () => {
    const f = vi.spyOn(globalThis, 'fetch').mockImplementation(() => { throw new Error('network used'); }); const d = dir(); const proc = Object.assign(new EventEmitter(), { exit: vi.fn() }) as never; const lines: string[] = [];
    const off = installCrashHandlers({ store: new CrashStore(d), proc, info: base, recentLog: () => ['x'], err: (l) => lines.push(l) }); (proc as unknown as EventEmitter).emit('uncaughtException', new Error('boom')); expect(f).not.toHaveBeenCalled(); expect(files(d)).toHaveLength(1); expect(lines[0]).toMatch(/centcom crash show/); expect((proc as unknown as { exit: ReturnType<typeof vi.fn> }).exit).toHaveBeenCalledWith(1); off(); f.mockRestore();
    for (const m of ['http', 'https', 'net', 'tls', 'dgram'] as const) expect(readFileSync(new URL('../../src/crash/report.ts', import.meta.url), 'utf8')).not.toContain(`node:${m}`);
  });
  it('with telemetry on, a crash with a code emits at most one error.shown with the code only; with no code or no callback, nothing', () => {
    const calls: string[] = []; const mk = () => { const proc = Object.assign(new EventEmitter(), { exit: vi.fn() }) as never; installCrashHandlers({ store: new CrashStore(dir()), proc, info: base, recentLog: () => [], err: () => undefined, onCode: (c) => calls.push(c) }); return proc as unknown as EventEmitter; };
    const p = mk(); p.emit('unhandledRejection', Object.assign(new Error('a'), { code: 'rate_limited' })); p.emit('uncaughtException', Object.assign(new Error('b'), { code: 'internal' })); expect(calls).toEqual(['rate_limited']); const q = mk(); q.emit('uncaughtException', new Error('no code')); expect(calls).toEqual(['rate_limited']);
  });
  it('a failing disk still ends the process with a message, not a second crash', () => { const proc = Object.assign(new EventEmitter(), { exit: vi.fn() }) as never; const lines: string[] = []; installCrashHandlers({ store: { save: () => { throw new Error('disk full'); } } as never, proc, info: base, recentLog: () => [], err: (l) => lines.push(l) }); (proc as unknown as EventEmitter).emit('uncaughtException', new Error('x')); expect(lines[0]).toMatch(/could not be saved/); expect((proc as unknown as { exit: ReturnType<typeof vi.fn> }).exit).toHaveBeenCalledWith(1); });
});
