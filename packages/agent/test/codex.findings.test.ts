import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { CodexMapper, errorCodeFromInfo, innerCommand } from '../src/codex/map.js';
import { ENV_EXCLUDE, CodexEngine, versionNote } from '../src/codex/engine.js';
import { findThreadPids, killThreadCommands } from '../src/codex/threadprocs.js';

describe('findings from the real Codex 0.161.0 run (questions.txt)', () => {
  it('commands are rated by what they run, not by the shell wrapper', () => {
    expect(innerCommand('/bin/zsh -lc ls', [{ command: 'ls' }])).toBe('ls'); expect(innerCommand("/bin/zsh -lc 'git status'")).toBe('git status'); expect(innerCommand('bash -c "cat a"')).toBe('cat a'); expect(innerCommand('ls -la')).toBe('ls -la');
    const m = new CodexMapper(); const ev = m.notification('item/started', { item: { type: 'commandExecution', id: 'c1', command: '/bin/zsh -lc ls', commandActions: [{ type: 'listFiles', command: 'ls' }] } });
    expect(ev.find((e) => e.type === 'tool.requested')).toMatchObject({ risk: 'low', input_summary: 'ls' });
    expect(m.approval('item/commandExecution/requestApproval', { itemId: 'c1', command: '/bin/zsh -lc "rm -rf build"' })).toMatchObject({ risk: 'high' });
  });
  it('errors are classified by codexErrorInfo first, text second', () => {
    expect(errorCodeFromInfo({ httpConnectionFailed: { httpStatusCode: 401 } }, 'x')).toBe('provider_not_signed_in'); expect(errorCodeFromInfo({ responseStreamDisconnected: { httpStatusCode: 429 } }, 'x')).toBe('provider_rate_limited');
    expect(errorCodeFromInfo('usageLimitExceeded', 'x')).toBe('provider_cap_reached'); expect(errorCodeFromInfo('rateLimitExceeded', 'x')).toBe('provider_rate_limited'); expect(errorCodeFromInfo('other', 'Please log in')).toBe('provider_not_signed_in'); expect(errorCodeFromInfo(undefined, 'boom')).toBe('provider_protocol_error');
    expect(new CodexMapper().notification('turn/completed', { turn: { status: 'failed', error: { message: 'x', codexErrorInfo: 'usageLimitExceeded' } } })[0]).toMatchObject({ code: 'provider_cap_reached' });
  });
  it('old or unknown-major versions get a note, the verified one does not', () => {
    expect(versionNote('centcom/0.161.0 (Mac OS 26.6.0; arm64) unknown')).toBeUndefined(); expect(versionNote('centcom/0.161.4')).toBeUndefined(); expect(versionNote('centcom/0.150.2 (x)')).toContain('older'); expect(versionNote('x/1.2.0')).toContain('newer'); expect(versionNote(undefined)).toBeUndefined(); expect(versionNote('nonsense')).toBeUndefined();
  });
  it('commands see no Centcom tokens or keys', () => { for (const k of ['CENTCOM_APPROVAL_SOCK', 'FAKE_SERVICE_API_KEY', 'CENTCOM_FAKE_TOKEN', 'GITHUB_SECRET']) expect(ENV_EXCLUDE.some((g) => new RegExp('^' + g.replace(/\*/g, '.*') + '$').test(k)), k).toBe(true); expect(ENV_EXCLUDE.some((g) => new RegExp('^' + g.replace(/\*/g, '.*') + '$').test('PATH'))).toBe(false); });
});
describe('stopping the commands Codex started', () => {
  const env = (m: Record<number, string>) => ({ listPids: () => Object.keys(m).map(Number), environOf: (p: number) => m[p], platform: 'linux' as const });
  it('finds only processes tagged with the thread and never the ones we name', () => {
    const d = env({ 10: 'A=1\0CODEX_THREAD_ID=t-1\0', 11: 'CODEX_THREAD_ID=t-12\0', 12: 'CODEX_THREAD_ID=t-1\0', 13: 'X=CODEX_THREAD_ID=t-1\0' });
    expect(findThreadPids('t-1', d)).toEqual([10, 12]); expect(findThreadPids('t-1', { ...d, self: [12] })).toEqual([10]); expect(findThreadPids('', d)).toEqual([]); expect(findThreadPids('t-1; rm', d)).toEqual([]);
    expect(findThreadPids('t-1', { platform: 'darwin', psEnv: () => ' 20 /bin/zsh -c sleep 61 CODEX_THREAD_ID=t-1 HOME=/x\n 21 other CODEX_THREAD_ID=t-9\n' })).toEqual([20]);
  });
  it('SIGTERM first, SIGKILL for what survives', async () => {
    const alive = new Set([10, 12]); const log: string[] = []; const d = { ...env({}), listPids: () => [...alive], environOf: () => 'CODEX_THREAD_ID=t-1\0' };
    const got = await killThreadCommands('t-1', { ...d, graceMs: 1, sleep: async () => undefined, kill: (pid, sig) => { log.push(`${sig}:${pid}`); if (sig === 'SIGTERM' && pid === 10) alive.delete(10); if (sig === 'SIGKILL') alive.delete(pid); } });
    expect(got).toEqual([10, 12]); expect(log).toEqual(['SIGTERM:10', 'SIGTERM:12', 'SIGKILL:12']); expect(await killThreadCommands('t-1', { ...d, listPids: () => [], sleep: async () => undefined })).toEqual([]);
  });
});
function fakeChild() { const c = new EventEmitter() as any; c.stdout = new PassThrough(); c.stderr = new PassThrough(); c.stdin = new PassThrough(); c.kill = () => true; c.pid = 4242; return c; }
/** Minimal app-server: answers requests from `answers`, records what it was sent. */
function server(child: any, answers: Record<string, (p: any) => any>) { const sent: any[] = []; let buf = ''; child.stdin.on('data', (c: Buffer) => { buf += c; let i: number; while ((i = buf.indexOf('\n')) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); sent.push(m); if (m.id !== undefined && m.method && answers[m.method]) child.stdout.write(JSON.stringify({ id: m.id, result: answers[m.method]!(m.params) }) + '\n'); else if (m.id !== undefined && m.method) child.stdout.write(JSON.stringify({ id: m.id, result: {} }) + '\n'); } }); return sent; }
describe('thread setup', () => {
  const answers = { initialize: () => ({ userAgent: 'centcom/0.150.0 (x)' }), 'account/read': () => ({ account: { type: 'chatgpt' } }), 'thread/start': () => ({ thread: { id: 't-9' }, model: 'm' }), 'thread/resume': () => ({ thread: { id: 't-9' }, model: 'm' }) };
  it('does not pass a sandbox to thread/start (it would trust the folder), filters the environment, warns about an old version', async () => {
    const child = fakeChild(); const sent = server(child, answers); const s = await new CodexEngine({ spawn: (() => child) as never, stallMs: 0 }).start({ agentId: 'agt_x', cwd: '/tmp/p', permissionMode: 'acceptEdits' });
    const ts = sent.find((m) => m.method === 'thread/start'); expect(ts.params).not.toHaveProperty('sandbox'); expect(ts.params.approvalPolicy).toBe('on-request'); expect(ts.params.config.shell_environment_policy.exclude).toEqual(ENV_EXCLUDE);
    const evs: any[] = []; (s.events as any).close(); for await (const e of s.events) evs.push(e); expect(evs.find((e) => e.type === 'engine.warning')).toMatchObject({ code: 'codex_version' });
  });
  it('resume asks for no history replay; every turn still carries the sandbox', async () => {
    const child = fakeChild(); const sent = server(child, { ...answers, 'turn/start': () => ({ turn: { id: 'u1' } }) }); const s = await new CodexEngine({ spawn: (() => child) as never, stallMs: 0 }).start({ agentId: 'agt_x', cwd: '/tmp/p', resume: { engine_session_id: 't-9' } }); await s.send('hi');
    expect(sent.find((m) => m.method === 'thread/resume').params).toMatchObject({ threadId: 't-9', excludeTurns: true }); expect(sent.find((m) => m.method === 'turn/start').params.sandboxPolicy).toEqual({ type: 'workspaceWrite' });
  });
  it('legacy approval requests get an error answer, not an invalid decision', async () => {
    const child = fakeChild(); const out: any[] = []; child.stdin.on('data', (c: Buffer) => { for (const l of String(c).split('\n').filter(Boolean)) out.push(JSON.parse(l)); }); const sent = server(child, answers); void sent;
    await new CodexEngine({ spawn: (() => child) as never, stallMs: 0 }).start({ agentId: 'agt_x', cwd: '/tmp/p' }); child.stdout.write(JSON.stringify({ id: 77, method: 'execCommandApproval', params: {} }) + '\n'); await new Promise((r) => setTimeout(r, 30));
    expect(out.find((m) => m.id === 77)).toMatchObject({ error: { code: -32601 } });
  });
});
