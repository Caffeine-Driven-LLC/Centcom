/* End to end through the real entry point (apps/cli/src/main.tsx) in a child process, against the mock on real time.
   The pty harness of lane C008 does not exist yet, so this drives the child over pipes: same code path, same output, no terminal. */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { startMockBackend, type MockBackend } from '@centcom/testkit';
import { MSG } from '../../src/commands/account/messages.js';

const main = fileURLToPath(new URL('../../src/main.tsx', import.meta.url));
let m: MockBackend; let home: string;
beforeAll(async () => { m = await startMockBackend({ clock: 'real', seed: 3 }); home = mkdtempSync(join(tmpdir(), 'centcom-e2e-')); });
afterAll(async () => { await m.stop(); rmSync(home, { recursive: true, force: true }); });
const kids: ChildProcess[] = []; afterEach(() => { for (const k of kids.splice(0)) k.kill('SIGKILL'); });

/** Start `centcom <args>` with a private HOME, the in-memory keychain, NO_COLOR and the mock as the API. */
function centcom(args: string[], onLine?: (line: string, p: ChildProcess) => void) {
  const env = { ...process.env, HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: join(home, '.config'), CENTCOM_STATE_DIR: join(home, '.centcom'), CENTCOM_CONFIG_DIR: join(home, 'config'), CENTCOM_KEYCHAIN: 'memory', CENTCOM_API_URL: m.url, CENTCOM_TELEMETRY: 'off', NO_COLOR: '1', FORCE_COLOR: '0' };
  const p = spawn(process.execPath, ['--import', 'tsx', main, ...args], { env, stdio: ['pipe', 'pipe', 'pipe'] }); kids.push(p);
  let out = ''; let err = ''; let buf = '';
  const feed = (s: string) => { buf += s; let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); onLine?.(line, p); } };
  p.stdout!.on('data', (d) => { out += String(d); feed(String(d)); }); p.stderr!.on('data', (d) => { err += String(d); feed(String(d)); });
  const done = new Promise<{ code: number | null; out: string; err: string }>((resolve) => p.on('exit', (code) => resolve({ code, out, err })));
  return { p, done };
}

describe('centcom account commands, end to end (NO_COLOR)', () => {
  it('whoami when not signed in: exit 2, the login hint on stderr, no colour codes, nothing on stdout', async () => {
    const r = await centcom(['whoami']).done;
    expect(r.code).toBe(2); expect(r.err.trim()).toBe(MSG.errors.notSignedIn); expect(r.out).toBe(''); expect(r.err).not.toMatch(/\x1b\[/);
  }, 30_000);
  it('login --no-browser: shows the code and link, is approved, signs in and exits 0', async () => {
    const r = await centcom(['login', '--no-browser'], (line) => { const c = /Code: (\S+)/.exec(line)?.[1]; if (c) void m.control('approve-device', { user_code: c }); }).done;
    expect(r.code).toBe(0); expect(r.out).toMatch(/^ {2}Code: [A-HJ-KM-NP-Z2-9]{4}-[A-HJ-KM-NP-Z2-9]{4}$/m); expect(r.out).toMatch(/https:\/\/centcom\.dev\/device\?user_code=/);
    expect(r.out).toMatch(/^Signed in as Dev Tester <dev@example\.test> on the \w+ plan\.$/m); expect(r.out + r.err).not.toMatch(/\x1b\[|eyJ|rt_|dc_/);
  }, 30_000);
  it('Ctrl-C while waiting: the child exits 1 within a second with the cancelled line', async () => {
    let sentAt = 0;
    const r = await centcom(['login', '--no-browser'], (line, p) => { if (line.startsWith('Waiting')) { sentAt = Date.now(); p.kill('SIGINT'); } }).done;
    expect(r.code).toBe(1); expect(Date.now() - sentAt).toBeLessThan(1000); expect(r.err).toContain(MSG.login.cancelled);
  }, 30_000);
});
