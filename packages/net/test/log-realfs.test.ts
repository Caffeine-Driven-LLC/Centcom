import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createFileSink, createLogger, nodeLogFs, type LogFs, type LogRecord } from '../src/index.js';

const dirs: string[] = []; afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'cc-log-')); dirs.push(d); return d; };

/** Lane C005, acceptance 5 and the secrets rule, on the real disk: nothing here is a fake file system. */
describe('the file sink on a real disk', () => {
  it('after about 12 MiB there are exactly 3 files, each within 5 MiB plus one record, files 0600 and the folder 0700', async () => {
    const dir = join(tmp(), 'logs'); const MAX = 5 * 1024 * 1024; const sink = createFileSink({ dir, maxBytes: MAX, maxFiles: 3, fs: nodeLogFs }); const line = JSON.stringify({ msg: 'x', pad: 'p'.repeat(8000) });
    for (let i = 0; i < 1550; i++) sink.write(line, {} as LogRecord); await sink.flush!();
    expect(readdirSync(dir).sort()).toEqual(['centcom.log', 'centcom.log.1', 'centcom.log.2']);
    for (const f of readdirSync(dir)) { const st = statSync(join(dir, f)); expect(st.size, f).toBeLessThanOrEqual(MAX + line.length + 1); expect(st.mode & 0o777, f).toBe(0o600); } expect(statSync(dir).mode & 0o777).toBe(0o700);
  });
  it('the secrets planted in a record are in no file after the logger redacted them (grep test)', async () => {
    const dir = tmp(); const sink = createFileSink({ dir, maxBytes: 1e6, maxFiles: 2, fs: nodeLogFs }); const log = createLogger({ level: 'info', sinks: [sink], clock: () => 0 });
    log.info('login', { authorization: 'Bearer abc.def.ghi-SECRET', nested: { refresh_token: 'rt-SECRET-123' }, command: 'curl -H "x: SECRET-CMD"' }); await sink.flush!();
    const all = readdirSync(dir).map((f) => readFileSync(join(dir, f), 'utf8')).join('\n'); for (const s of ['abc.def.ghi', 'SECRET', 'rt-', 'curl']) expect(all).not.toContain(s); expect(all).toContain('[redacted]');
  });
  it('a full disk is counted and the note that says so uses the injected clock', async () => {
    const dir = tmp(); let full = true; const fs: LogFs = { ...nodeLogFs, append: async (p, d, m) => { if (full) throw new Error('ENOSPC'); return nodeLogFs.append(p, d, m); } };
    const sink = createFileSink({ dir, maxBytes: 1e6, maxFiles: 2, fs, clock: () => Date.parse('2026-10-14T12:00:00Z') }); for (let i = 0; i < 3; i++) sink.write('{"msg":"a"}', {} as LogRecord); await sink.flush!();
    full = false; sink.write('{"msg":"b"}', {} as LogRecord); await sink.flush!(); const out = readFileSync(join(dir, 'centcom.log'), 'utf8'); expect(out).toContain('"ts":"2026-10-14T12:00:00.000Z"'); expect(out).toContain('"count":3');
  });
  it('a folder that cannot be made drops quietly and says why once', async () => {
    const reasons: string[] = []; const file = join(tmp(), 'a-file'); writeFileSync(file, 'x'); const sink = createFileSink({ dir: join(file, 'logs'), maxBytes: 1e6, maxFiles: 2, fs: nodeLogFs, onUnavailable: (r) => reasons.push(r) }); sink.write('{"msg":"a"}', {} as LogRecord); sink.write('{"msg":"b"}', {} as LogRecord); await sink.flush!(); expect(reasons).toHaveLength(1);
  });
});
