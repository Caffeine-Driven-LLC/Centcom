/* `centcom webhooks` and `centcom audit` through the real entry point (apps/cli/src/main.tsx), signed in against the mock backend: they use the stored sign-in like `whoami` does (lane C069/C070 wiring). */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { startMockBackend, type MockBackend } from '@centcom/testkit';

const main = fileURLToPath(new URL('../../src/main.tsx', import.meta.url));
let m: MockBackend; let home: string;
beforeAll(async () => { m = await startMockBackend({ clock: 'real', seed: 3 }); home = mkdtempSync(join(tmpdir(), 'centcom-authed-')); });
afterAll(async () => { await m.stop(); rmSync(home, { recursive: true, force: true }); });
const kids: ChildProcess[] = []; afterEach(() => { for (const k of kids.splice(0)) k.kill('SIGKILL'); });
function centcom(args: string[], onLine?: (line: string) => void, stdin?: string) {
  const env = { ...process.env, HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: join(home, '.config'), CENTCOM_STATE_DIR: join(home, '.centcom'), CENTCOM_CONFIG_DIR: join(home, 'config'), CENTCOM_KEYCHAIN: `file:${join(home, 'keychain')}`, CENTCOM_API_URL: m.url, CENTCOM_TELEMETRY: 'off', NO_COLOR: '1', FORCE_COLOR: '0' };
  const p = spawn(process.execPath, ['--import', 'tsx', main, ...args], { env, stdio: ['pipe', 'pipe', 'pipe'] }); kids.push(p); if (stdin !== undefined) p.stdin!.end(stdin);
  let out = ''; let err = ''; let buf = ''; const feed = (s: string) => { buf += s; let i; while ((i = buf.indexOf('\n')) >= 0) { onLine?.(buf.slice(0, i)); buf = buf.slice(i + 1); } };
  p.stdout!.on('data', (d) => { out += String(d); feed(String(d)); }); p.stderr!.on('data', (d) => { err += String(d); feed(String(d)); });
  return new Promise<{ code: number | null; out: string; err: string }>((resolve) => p.on('exit', (code) => resolve({ code, out, err })));
}

describe('webhooks and audit use the stored sign-in', () => {
  it('signed out they say so and exit 2, with no request made', async () => {
    for (const cmd of [['webhooks', 'list'], ['audit', 'list']]) { const r = await centcom(cmd); expect(r.code, r.err).toBe(2); expect(r.err).toMatch(/centcom login/); expect(r.out).toBe(''); }
  }, 60_000);
  it('after login: webhooks list and audit list run as the person (exit 0 or 4 for no events, never a crash), and help names them', async () => {
    const login = await centcom(['login', '--no-browser'], (line) => { const c = /Code: (\S+)/.exec(line)?.[1]; if (c) void m.control('approve-device', { user_code: c }); }); expect(login.code, login.err).toBe(0);
    const w = await centcom(['webhooks', 'list', '--json']); expect(w.code, w.err).toBe(0); expect(() => JSON.parse(w.out)).not.toThrow(); expect(w.out + w.err).not.toMatch(/\x1b\[|Bearer |eyJ/);
    const a = await centcom(['audit', 'list', '--json']); expect([0, 4]).toContain(a.code); expect(a.err).not.toMatch(/TypeError|undefined/);
    const bad = await centcom(['webhooks', 'create', '--url', 'http://example.test/x', '--event', 'session.started']); expect(bad.code).toBe(1); expect(bad.err).toMatch(/https/i);
    const h = await centcom(['help']); expect(h.out).toMatch(/webhooks/); expect(h.out).toMatch(/audit/);
  }, 120_000);
  it('create against the service: the address and events are checked here, the id comes back, and the secret is shown only when asked for (never in the JSON output)', async () => {
    const quiet = await centcom(['webhooks', 'create', '--url', 'https://hooks.example.test/in', '--event', 'session.started', '--json']); expect(quiet.code, quiet.err).toBe(0); expect(quiet.out).not.toMatch(/whsec_|"secret"/); expect(quiet.out).toMatch(/whk_/);
    const shown = await centcom(['webhooks', 'create', '--url', 'https://hooks.example.test/in', '--event', 'session.started', '--show-secret']); expect(shown.code, shown.err).toBe(0); expect(shown.out + shown.err).toMatch(/whk_/);
  }, 120_000);
});
