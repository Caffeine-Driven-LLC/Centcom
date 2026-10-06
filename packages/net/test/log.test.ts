import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { collectDiagnostics, createFileSink, createLogger, createRingSink, looksLikeSecret, redact, type LogFs, type LogRecord, type Sink } from '../src/index.js';

const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const CT = 'q9Zk4-Vn8Xr2_Tm7Lp5Wc3Yd6Ha1Gb0Fe9Ij8Ok7Nl6Mh5Pg4Qf3Re2Sd1Tc0Ub9Vz8Wy7Xx6Aw5Bv4Cu3Dt2Es1Fr';
const mem = () => { const lines: string[] = []; return { lines, sink: { write: (l: string) => { lines.push(l); } } as Sink }; };
const log = (level: 'trace' | 'debug' | 'info' | 'warn' | 'error' = 'info', extra: Partial<Parameters<typeof createLogger>[0]> = {}) => { const m = mem(); return { ...m, logger: createLogger({ level, sinks: [m.sink], clock: () => Date.UTC(2026, 9, 5, 12, 0, 0), ...extra }) }; };

describe('records', () => {
  it('one JSON object per line with ts, level, component, msg and bindings', () => {
    const { logger, lines } = log(); logger.child({ component: 'http', request_id: 'req_01JA3Z8K2M5N7P9Q0R1S2T3V4W', session_id: 'ses_01JA3Z8K2M5N7P9Q0R1S2T3V4W' }).info('http.retry', { attempt: 2, status: 503 });
    expect(JSON.parse(lines[0]!)).toEqual({ ts: '2026-10-05T12:00:00.000Z', level: 'info', component: 'http', msg: 'http.retry', request_id: 'req_01JA3Z8K2M5N7P9Q0R1S2T3V4W', session_id: 'ses_01JA3Z8K2M5N7P9Q0R1S2T3V4W', attempt: 2, status: 503 });
  });
  it('callers cannot overwrite the structural fields through context', () => { const { logger, lines } = log(); logger.info('x', { level: 'debug', msg: 'evil', ts: 'then' }); const r = JSON.parse(lines[0]!); expect(r.level).toBe('info'); expect(r.msg).toBe('x'); expect(r.ctx_level).toBe('debug'); });
});

describe('redaction (acceptance 1 to 3)', () => {
  it('redacts authorization and nested refresh_token, and the raw strings appear nowhere', () => {
    const { logger, lines } = log(); logger.info('auth.test', { authorization: 'Bearer abc.def.ghi', nested: { refresh_token: 'x-secret-value-123' } });
    const r = JSON.parse(lines[0]!); expect(r.authorization).toBe('[redacted]'); expect(r.nested.refresh_token).toBe('[redacted]'); expect(lines.join('')).not.toMatch(/abc\.def|x-secret-value/);
  });
  it('removes JWTs, cen_live_ keys, ciphertext and paths from free text', () => {
    const { logger, lines } = log(); logger.info('free.text', { note: `jwt ${JWT} key cen_live_abcdef123456 ct ${CT} at /home/alex/project/src/a.ts and C:\\Users\\alex\\x.txt mail me@example.com` });
    const out = lines.join(''); for (const bad of [JWT.slice(0, 20), 'cen_live_abcdef', CT.slice(0, 30), '/home/alex', 'alex\\\\x', 'me@example.com']) expect(out, bad).not.toContain(bad);
  });
  it('always redacts text, delta, command, branch, cwd and ct at any depth, in arrays and error causes', () => {
    const { logger, lines } = log(); const err = new Error('boom', { cause: { command: 'rm -rf /' } });
    logger.error('deep', { a: { b: { list: [{ text: 'hello world', delta: 'tok', command: 'ls', branch: 'feat/x', cwd: '/w', ct: 'abc' }] } }, err });
    const out = lines.join(''); for (const leaked of ['hello world', '"tok"', '"ls"', 'feat/x', 'rm -rf', '"abc"']) expect(out, leaked).not.toContain(leaked);
    expect((JSON.parse(lines[0]!).a.b.list[0] as Record<string, string>).text).toBe('[redacted]');
  });
  it('leaves ULIDs, sha256 digests, versions and plain words alone (false-positive guard)', () => {
    const benign = ['ses_01JA3Z8K2M5N7P9Q0R1S2T3V4W', 'sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08', '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08', '1.4.2', '1.2.0-rc.1', 'http.retry', 'GET /v1/sessions', 'attempt 3 of 5', 'queue_full', 'claude-sonnet-5-5', 'https://api.centcom.dev/v1/auth/token', 'task-management-system-overview'];
    for (const s of benign) expect(redact({ note: s }), s).toEqual({ note: s });
    for (const s of benign) expect(looksLikeSecret(s), s).toBe(false);
  });
  it('table of secret shapes', () => {
    const shapes = [JWT, 'sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'sk-proj-ABCDEFGHIJKLMNOPQRSTUVWXYZ012345', 'AKIAABCDEFGHIJKLMNOP', 'AIzaSyA-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456', 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123', 'cen_live_AbCdEf123456789', 'cen_test_AbCdEf123456789', CT, '/Users/alex/Documents/secret.txt', '/home/runner/work/x/y', 'C:\\Users\\alex\\proj', '~/projects/app/src', 'alex@example.com', '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----', '{"access_token":"abcdefghijklmnopqrstuvwxyz"}', '{"refresh_token": "abcdefghijklmnopqrstuvwxyz0123"}'];
    for (const s of shapes) { expect(looksLikeSecret(s), s).toBe(true); const r = redact({ note: `x ${s} y` }) as { note: string }; expect(r.note, s).not.toContain(s.slice(0, 18)); }
  });
  it('replaces the home directory with ~', () => { expect(redact({ note: 'opened /home/alex/x' }, '/home/alex')).toBeTruthy(); const { logger, lines } = log('info', { home: '/home/alex' }); logger.info('x', { note: 'config in /home/alex' }); expect(lines[0]).not.toContain('/home/alex'); });
});

describe('safety limits (acceptance 4)', () => {
  it('survives a circular object and a 5 MB string, within 16 KiB', () => {
    const { logger, lines } = log(); const o: Record<string, unknown> = { a: 1 }; o.self = o; logger.info('weird', { o, big: 'word '.repeat(1_000_000), blob: 'x'.repeat(5_000_000), many: Array.from({ length: 500 }, (_, i) => i) });
    expect(lines).toHaveLength(1); expect(lines[0]!.length).toBeLessThanOrEqual(16 * 1024); const r = JSON.parse(lines[0]!); expect(r.o.self).toBe('[circular]'); expect(r.big).toContain('[truncated'); expect(r.blob).toBe('[redacted]'); // a 5 MB opaque run looks like a key, so it is removed expect(r.many).toHaveLength(51);
  });
  it('caps depth at 6 and never throws on getters, bigints and symbols', () => {
    const deep: Record<string, unknown> = {}; let cur = deep; for (let i = 0; i < 20; i++) { cur.next = {}; cur = cur.next as Record<string, unknown>; }
    const { logger, lines } = log(); expect(() => logger.info('x', { deep, big: 10n, s: Symbol('x'), fn: () => 1, get boom() { throw new Error('no'); } })).not.toThrow(); expect(lines[0]).toContain('[depth]');
  });
  it('fails closed when the redactor itself throws: no context at all', () => {
    const { logger, lines } = log('info', { redactor: () => { throw new Error('bug'); } }); logger.info('x', { secret: 'sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZ' }); expect(JSON.parse(lines[0]!)).toMatchObject({ msg: 'log.redaction_failed' }); expect(lines[0]).not.toContain('sk-ant');
  });
  it('a failing sink never breaks the caller or the other sinks', () => { const m = mem(); const bad: Sink = { write() { throw new Error('disk'); } }; const l = createLogger({ level: 'info', sinks: [bad, m.sink], clock: () => 0 }); expect(() => l.info('x')).not.toThrow(); expect(m.lines).toHaveLength(1); });
  it('fuzz: arbitrary values never throw and never leak a planted canary', () => {
    const canary = 'CANARY-sk-ant-api03-ZZZZZZZZZZZZZZZZZZZZZZZZZZ';
    fc.assert(fc.property(fc.anything({ maxDepth: 5 }), fc.string(), (v, k) => { const m = mem(); const l = createLogger({ level: 'info', sinks: [m.sink], clock: () => 0 }); l.info('fuzz', { value: v, [k || 'k']: { token: canary, nested: [canary] }, authorization: canary }); return m.lines.length === 1 && !m.lines[0]!.includes('ZZZZZZZZZZ'); }), { numRuns: 300 });
  });
});

describe('levels (acceptance 6)', () => {
  it('drops records below the level, and does it cheaply', () => {
    const { logger, lines } = log('info'); logger.debug('nope'); logger.trace('nope'); logger.info('yes'); logger.warn('yes'); expect(lines).toHaveLength(2);
    const t = performance.now(); for (let i = 0; i < 100_000; i++) logger.debug('dropped', { i, big: { a: 1 } }); expect(performance.now() - t).toBeLessThan(100);
  });
});

/** an in-memory disk that can run out of space */
function memFs(opts: { full?: () => boolean } = {}): LogFs & { files: Map<string, string>; modes: Map<string, number>; dirs: Map<string, number> } {
  const files = new Map<string, string>(), modes = new Map<string, number>(), dirs = new Map<string, number>();
  return { files, modes, dirs, mkdir: (d, m) => { dirs.set(d, m); }, async append(p, d, m) { if (opts.full?.()) throw Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' }); files.set(p, (files.get(p) ?? '') + d); if (!modes.has(p)) modes.set(p, m); }, size: (p) => Buffer.byteLength(files.get(p) ?? ''), rename(a, b) { files.set(b, files.get(a)!); modes.set(b, modes.get(a)!); files.delete(a); modes.delete(a); }, remove(p) { files.delete(p); modes.delete(p); }, exists: (p) => files.has(p) || dirs.has(p) };
}
describe('file sink (acceptance 5)', () => {
  it('rotates at the size limit and keeps exactly 3 files, each private and within the limit', async () => {
    const fs = memFs(); const MAX = 5 * 1024 * 1024; const sink = createFileSink({ dir: '/logs', maxBytes: MAX, maxFiles: 3, fs }); const line = JSON.stringify({ msg: 'x', pad: 'p'.repeat(4000) });
    for (let i = 0; i < 3300; i++) sink.write(line, {} as LogRecord); await sink.flush!(); // about 13 MB
    expect([...fs.files.keys()].sort()).toEqual(['/logs/centcom.log', '/logs/centcom.log.1', '/logs/centcom.log.2']);
    for (const [p, c] of fs.files) { expect(Buffer.byteLength(c), p).toBeLessThanOrEqual(MAX + line.length + 1); expect(fs.modes.get(p), p).toBe(0o600); } expect(fs.dirs.get('/logs')).toBe(0o700);
  });
  it('drops records when the disk is full, counts them, and says so when space returns', async () => {
    let full = true; const fs = memFs({ full: () => full }); const sink = createFileSink({ dir: '/logs', maxBytes: 1e6, maxFiles: 3, fs });
    for (let i = 0; i < 5; i++) sink.write('{"msg":"a"}', {} as LogRecord); await sink.flush!(); expect(fs.files.get('/logs/centcom.log')).toBeUndefined();
    full = false; sink.write('{"msg":"b"}', {} as LogRecord); await sink.flush!(); const out = fs.files.get('/logs/centcom.log')!; expect(out).toContain('"msg":"log.dropped"'); expect(out).toContain('"count":5'); expect(out).toContain('{"msg":"b"}');
  });
  it('is not blocking: write returns before the data is on disk', async () => { const fs = memFs(); const sink = createFileSink({ dir: '/l', maxBytes: 1e6, maxFiles: 3, fs }); sink.write('{"a":1}', {} as LogRecord); expect(fs.files.size).toBe(0); await sink.flush!(); expect(fs.files.size).toBe(1); });
  it('falls back quietly when the directory cannot be created', async () => {
    let said = ''; const fs = { ...memFs(), mkdir() { throw new Error('EACCES'); } }; const sink = createFileSink({ dir: '/nope', maxBytes: 1e6, maxFiles: 3, fs, onUnavailable: (r) => { said = r; } }); expect(() => sink.write('{}', {} as LogRecord)).not.toThrow(); await sink.flush!(); expect(said).toContain('EACCES');
  });
  it('keeps order even if the clock goes backwards', () => { let t = 5000; const m = mem(); const l = createLogger({ level: 'info', sinks: [m.sink], clock: () => t }); l.info('first'); t = 1000; l.info('second'); expect(m.lines.map((x) => JSON.parse(x).msg)).toEqual(['first', 'second']); });
});

describe('ring sink and diagnostics (acceptance 7)', () => {
  it('keeps the last 500 records', () => { const ring = createRingSink(); const l = createLogger({ level: 'info', sinks: [ring], clock: () => 0 }); for (let i = 0; i < 700; i++) l.info('n', { i }); const s = ring.snapshot(); expect(s).toHaveLength(500); expect(s[0]!.i).toBe(200); expect(s.at(-1)!.i).toBe(699); });
  it('contains no secrets, no deny-listed values and no home directory, for any config', () => {
    fc.assert(fc.property(fc.array(fc.record({ key: fc.constantFrom('log.level', 'client.model', 'api.token', 'auth.password', 'client.path', 'ui.theme', 'x.email'), layer: fc.constantFrom('user', 'project', 'env'), value: fc.oneof(fc.string(), fc.boolean(), fc.integer()) }), { maxLength: 8 }), (config) => {
      const ring = createRingSink(); const l = createLogger({ level: 'info', sinks: [ring], clock: () => 0, home: '/home/alex' }); l.info('boot', { path: '/home/alex/p', token: JWT });
      const d = JSON.stringify(collectDiagnostics({ version: '1.0.0', os: { platform: 'linux', arch: 'x64' }, node: '22', colorTier: 'truecolor', home: '/home/alex', config: [...config, { key: 'api.token', layer: 'user', value: JWT }, { key: 'client.path', layer: 'user', value: '/home/alex/secret' }], ring }));
      return !d.includes(JWT.slice(0, 20)) && !d.includes('/home/alex') && !d.includes('"/home');
    }));
  });
  it('hides sensitive keys but keeps ordinary settings, with where they came from', () => {
    const d = collectDiagnostics({ version: '1.0.0', os: { platform: 'linux', arch: 'x64' }, node: '22.9.0', colorTier: '256', config: [{ key: 'log.level', layer: 'user', value: 'debug' }, { key: 'auth.api_key', layer: 'user', value: 'x' }, { key: 'client.model', layer: 'flag', value: 'opus' }] });
    expect(d.config).toEqual([{ key: 'log.level', layer: 'user', value: 'debug' }, { key: 'auth.api_key', layer: 'user', hidden: true }, { key: 'client.model', layer: 'flag', value: 'opus' }]); expect(d.contract).toMatch(/^\d+\.\d+\.\d+$/); expect(d.recent).toEqual([]);
  });
});
