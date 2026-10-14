import { spawn, type ChildProcess } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, statSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { connectRunner, createFileLog, preflightFromDetector, type ProviderDetector, type ProviderStatus } from '../../src/index.js';

/** Lane C013 at daemon level: the real `runnerd` process, its socket, its log, its preflight and its shutdown, with the stand-in `claude` of the interrupt tests as the engine. */
const RUNNERD = fileURLToPath(new URL('../../bin/runnerd.ts', import.meta.url)); const FAKE = fileURLToPath(new URL('../fixtures/fake-claude.mjs', import.meta.url)); chmodSync(FAKE, 0o755);
const kids: ChildProcess[] = []; afterEach(() => { for (const k of kids.splice(0)) k.kill('SIGKILL'); });
async function daemon(args: string[] = [], env: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'runnerd-')); const sock = join(dir, 'd', 'runner.sock');
  const p = spawn(process.execPath, ['--import', 'tsx', RUNNERD, '--socket', sock, ...args], { env: { ...process.env, CENTCOM_CLAUDE_BIN: FAKE, ...env }, stdio: ['ignore', 'pipe', 'pipe'] }); kids.push(p);
  let err = ''; p.stderr!.on('data', (c) => { err += c; });
  const info = await new Promise<{ socket: string; secret_file: string; log_file: string }>((res, rej) => { let out = ''; p.stdout!.on('data', (c) => { out += c; const i = out.indexOf('\n'); if (i >= 0) res(JSON.parse(out.slice(0, i))); }); p.once('exit', (c) => rej(new Error(`runnerd exited ${c}: ${err}`))); setTimeout(() => rej(new Error('runnerd did not start: ' + err)), 20_000); });
  const exit = new Promise<number | null>((res) => p.once('exit', (c) => res(c)));
  return { p, info, exit, dir, client: async () => connectRunner(info.socket, readFileSync(info.secret_file, 'utf8')) };
}
const lines = (file: string) => readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);

describe('the runnerd process', () => {
  it('starts private (socket 0600, folder 0700, secret and log 0600), runs an agent end to end through the socket, stops a turn with the CLI\'s receipt, and shuts down on request', async () => {
    const d = await daemon(); expect(statSync(d.info.socket).mode & 0o777).toBe(0o600); expect(statSync(join(d.info.socket, '..')).mode & 0o777).toBe(0o700); expect(statSync(d.info.secret_file).mode & 0o777).toBe(0o600);
    const c = await d.client(); const cwd = mkdtempSync(join(tmpdir(), 'work-')); await mkdir(cwd, { recursive: true });
    const { agent_id } = (await c.call('start', { spec: { engine: 'claude-code', cwd } })) as { agent_id: string }; const evts: { event: { type: string; outcome?: string } }[] = []; c.onEvent((e) => evts.push(e as never));
    await c.call('subscribe', { agent_id, replay: true }); await c.call('send', { agent_id, prompt: 'count' });
    for (let i = 0; i < 300 && !evts.some((e) => e.event.type === 'text.delta'); i++) await new Promise((r) => setTimeout(r, 20)); expect(evts.some((e) => e.event.type === 'text.delta')).toBe(true);
    await c.call('interrupt', { agent_id }); for (let i = 0; i < 300 && !evts.some((e) => e.event.type === 'turn.done'); i++) await new Promise((r) => setTimeout(r, 20));
    expect(evts.find((e) => e.event.type === 'turn.done')?.event.outcome).toBe('canceled'); expect(((await c.call('list')) as { status: string }[])[0]!.status).toBe('waiting');
    await c.call('shutdown'); expect(await d.exit).toBe(0);
    const log = lines(d.info.log_file); expect(statSync(d.info.log_file).mode & 0o777).toBe(0o600); expect(log.map((l) => l.msg)).toEqual(expect.arrayContaining(['daemon.started', 'agent.started', 'daemon.shutdown']));
    for (const l of log) expect(JSON.stringify(l)).not.toContain(cwd); // ids and kinds only: no paths
  }, 60_000);
  it('refuses an engine that is not installed before anything is spawned, and says so in words the client can show', async () => {
    const d = await daemon([], { CENTCOM_CLAUDE_BIN: '/nonexistent/claude' }); const c = await d.client();
    await expect(c.call('start', { spec: { engine: 'claude-code', cwd: tmpdir() } })).rejects.toMatchObject({ code: 'provider_not_installed' });
    expect(await c.call('list')).toEqual([]); await c.call('shutdown'); await d.exit;
  }, 60_000);
  it('refuses a version outside the checked range unless --unsupported-ok', async () => {
    const old = await daemon([], { FAKE_CLAUDE_VERSION: '1.0.3 (Claude Code)' }); const c = await old.client();
    await expect(c.call('start', { spec: { engine: 'claude-code', cwd: tmpdir() } })).rejects.toMatchObject({ code: 'provider_version_unsupported' }); await c.call('shutdown'); await old.exit;
    const ok = await daemon(['--unsupported-ok'], { FAKE_CLAUDE_VERSION: '1.0.3 (Claude Code)' }); const c2 = await ok.client(); const r = (await c2.call('start', { spec: { engine: 'claude-code', cwd: tmpdir() } })) as { agent_id: string }; expect(r.agent_id).toMatch(/^agt_/);
    await c2.call('shutdown'); await ok.exit;
  }, 90_000);
  it('leaves by itself after --idle-exit-s with nobody connected and nothing running, and a second daemon on the same socket says it is already running', async () => {
    const a = await daemon(['--idle-exit-s', '1']); const t0 = Date.now(); expect(await a.exit).toBe(0); expect(Date.now() - t0).toBeLessThan(8000);
    const b = await daemon(['--idle-exit-s', '30']); const second = spawn(process.execPath, ['--import', 'tsx', RUNNERD, '--socket', b.info.socket], { stdio: ['ignore', 'ignore', 'pipe'] }); kids.push(second); let msg = ''; second.stderr!.on('data', (x) => { msg += x; });
    expect(await new Promise<number | null>((res) => second.once('exit', (c) => res(c)))).toBe(1); expect(msg).toContain('already running'); b.p.kill('SIGTERM'); await b.exit;
  }, 90_000);
});

describe('the preflight', () => {
  const status = (o: Partial<ProviderStatus>): ProviderStatus => ({ engine: 'claude-code', provider: 'anthropic', installed: true, version: '2.1.289', supported: 'yes', supported_range: '>=2.0.0 <3.0.0', signed_in: 'yes', login_kind: 'subscription', effective_kind: 'subscription', checked_at: '', errors: [], ...o });
  const det = (s: ProviderStatus): ProviderDetector => ({ detect: async () => s, detectAll: async () => [s] });
  it('lets an installed, supported tool through, stops a missing or unsupported one, and lets the person override the version rule', async () => {
    await expect(preflightFromDetector(det(status({})))('claude-code')).resolves.toBeUndefined();
    await expect(preflightFromDetector(det(status({ installed: false })))('claude-code')).rejects.toMatchObject({ code: 'provider_not_installed' });
    await expect(preflightFromDetector(det(status({ supported: 'above', version: '3.1.0' })))('claude-code')).rejects.toMatchObject({ code: 'provider_version_unsupported' });
    await expect(preflightFromDetector(det(status({ supported: 'below' })), { unsupportedOk: true })('claude-code')).resolves.toBeUndefined();
    await expect(preflightFromDetector(det(status({ installed: false })))('fake' as never)).resolves.toBeUndefined(); // test and demo engines have nothing to find
  });
});

describe('the file log', () => {
  const clock = { now: () => 0, setTimeout: () => 0, clearTimeout: () => undefined };
  it('counts the size cap in bytes, not characters: text in other scripts and emoji cannot push the file past it', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'rlog-')), 'wide.log'); const log = createFileLog({ path, clock, maxBytes: 1000, level: 'info' });
    for (let i = 0; i < 12; i++) log.info('wide', { text: '日本語のログ🙂'.repeat(8) + i }); await log.flush(); // each line is ~220 characters but ~420 bytes
    expect(statSync(path).size).toBeLessThanOrEqual(1000); expect(statSync(path + '.1').size).toBeLessThanOrEqual(1000);
  });
  it('writes one JSON line per event, scrubs credentials, honours the level, and starts again past the size cap', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'rlog-')), 'x.log'); const log = createFileLog({ path, clock, maxBytes: 600, level: 'info' });
    log.debug('hidden'); log.info('a', { token: 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789' }); await log.flush(); const first = readFileSync(path, 'utf8'); expect(first).not.toContain('hidden'); expect(first).not.toContain('abcdefghijklmnopqrstuvwxyz'); expect(JSON.parse(first.trim())).toMatchObject({ level: 'info', msg: 'a' });
    for (let i = 0; i < 20; i++) log.warn('w' + i, { i }); await log.flush(); expect(statSync(path).size).toBeLessThanOrEqual(700); expect(readFileSync(path + '.1', 'utf8').length).toBeGreaterThan(0); expect(statSync(path).mode & 0o777).toBe(0o600);
  });
});
