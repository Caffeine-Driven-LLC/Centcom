import { chmodSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { ClaudeCodeEngine, createProcessRegistry, claudeVersionProbe, createInterruptController, type EngineSession, type NormalisedEvent } from '../../src/index.js';

/** Lane C030/C102 against a real child process: a stand-in `claude` executable (test/fixtures/fake-claude.mjs) that speaks the stream-json shapes of the recording, answers an interrupt request with a receipt, and exits on SIGINT. */
const FAKE = fileURLToPath(new URL('../fixtures/fake-claude.mjs', import.meta.url)); chmodSync(FAKE, 0o755);
const sessions: EngineSession[] = []; afterEach(async () => { for (const s of sessions.splice(0)) await s.stop?.().catch(() => undefined); });
const tmp = () => mkdtempSync(join(tmpdir(), 'fake-claude-'));
const engine = (env: Record<string, string | undefined> = {}, deps: Partial<ConstructorParameters<typeof ClaudeCodeEngine>[0]> = {}) => ({ procs: createProcessRegistry(), env, make(d: object = {}) { return new ClaudeCodeEngine({ bin: FAKE, procs: this.procs, ...deps, ...d }); } });
async function start(e: ReturnType<typeof engine>, o: Partial<Parameters<ClaudeCodeEngine['start']>[0]> = {}, d: object = {}) { const s = await e.make(d).start({ agentId: 'agt_a', cwd: tmp(), env: e.env, ...o }); sessions.push(s); return s; }
async function until(s: EngineSession, pred: (e: NormalisedEvent) => boolean, out: NormalisedEvent[] = []): Promise<NormalisedEvent[]> { for await (const ev of s.events) { out.push(ev); if (pred(ev)) break; } return out; }

describe('an interrupt the CLI confirms (interrupt_receipt_v1)', () => {
  it('asks by request, gets the receipt, and no signal is sent: the turn ends as cancelled and the process leaves by itself', async () => {
    const e = engine(); const s = await start(e); const evs: NormalisedEvent[] = [];
    await s.send('count'); await until(s, (x) => x.type === 'text.delta', evs);
    const r = await s.interrupt(); expect(r).toMatchObject({ stopped: true, method: 'protocol', receipt: true, terminated: [] });
    await until(s, (x) => x.type === 'turn.done', evs); const done = evs.at(-1)!; expect(done).toMatchObject({ type: 'turn.done', outcome: 'canceled' });
    expect(evs.some((x) => x.type === 'error')).toBe(false); expect(evs.some((x) => x.type === 'status' && x.state === 'idle')).toBe(true);
    expect(e.procs.pids("agt_a")).toEqual([]);
  });
  it('the next prompt starts a normal turn in the same session', async () => {
    const e = engine(); const s = await start(e); await s.send('one'); await until(s, (x) => x.type === 'text.delta'); await s.interrupt(); await until(s, (x) => x.type === 'turn.done');
    expect(s.resumeToken?.()).toBe('fake-session-1'); await s.send('two'); const evs = await until(s, (x) => x.type === 'text.delta'); expect(evs.at(-1)).toMatchObject({ type: 'text.delta' });
  });
  it('the controller passes the receipt on', async () => {
    const e = engine(); const s = await start(e); await s.send('count'); await until(s, (x) => x.type === 'text.delta');
    const ctl = createInterruptController({ targets: { get: () => ({ busy: () => true, turnId: () => 't', interrupt: (o) => s.interrupt(o) }), busyIds: () => ['a'] }, approvals: { cancel: () => 0 }, states: { interrupted: () => undefined }, emit: () => undefined });
    expect(await ctl.interrupt('a')).toMatchObject({ method: 'protocol', receipt: true });
  });
});

describe('when there is no receipt', () => {
  it('a CLI that does not advertise it gets the signal ladder (SIGINT ends it), method sigint, receipt false', async () => {
    const e = engine({ FAKE_CLAUDE_RECEIPT: '0' }); const s = await start(e); await s.send('count'); await until(s, (x) => x.type === 'text.delta');
    const r = await s.interrupt(); expect(r).toMatchObject({ stopped: true, method: 'sigint', receipt: false }); expect(r.terminated?.map((k) => k.signal)).toEqual(['SIGINT']);
    expect((await until(s, (x) => x.type === 'turn.done')).at(-1)).toMatchObject({ outcome: 'canceled' });
  });
  it('one that advertises it but never answers is given the grace time, then the ladder runs', async () => {
    const e = engine({ FAKE_CLAUDE_IGNORE_CONTROL: '1' }); const s = await start(e, { limits: { interrupt_grace_ms: 300 } }); await s.send('count'); await until(s, (x) => x.type === 'text.delta');
    const t0 = Date.now(); const r = await s.interrupt(); expect(Date.now() - t0).toBeGreaterThanOrEqual(250); expect(r).toMatchObject({ method: 'sigint', receipt: false }); expect(r.terminated?.[0]?.signal).toBe('SIGINT');
    expect((await until(s, (x) => x.type === 'turn.done')).at(-1)).toMatchObject({ outcome: 'canceled' });
  });
  it('hard skips the request and the grace: SIGKILL at once', async () => {
    const e = engine(); const s = await start(e); await s.send('count'); await until(s, (x) => x.type === 'text.delta');
    const r = await s.interrupt({ hard: true }); expect(r.method).toBe('sigint'); expect(r.terminated?.map((k) => k.signal)).toEqual(['SIGKILL']);
  });
});

describe('the engine checks what it starts (C102)', () => {
  it('reads the arguments: stream-json in and out, the prompt not among them, ask mode by default', async () => {
    const file = join(tmp(), 'argv.json'); const e = engine({ FAKE_CLAUDE_ARGV_FILE: file }); const s = await start(e); await s.send('a secret prompt'); await until(s, (x) => x.type === 'text.delta'); await s.interrupt();
    const argv = JSON.parse(readFileSync(file, 'utf8')) as string[]; expect(argv.slice(0, 3)).toEqual(['-p', '--input-format', 'stream-json']); expect(argv.join(' ')).not.toContain('secret'); expect(argv[argv.indexOf('--permission-mode') + 1]).toBe('manual');
  });
  it('bypass has to be asked for: a session that starts in bypass without allowBypass runs in ask mode and says so; with allowBypass it bypasses', async () => {
    const f1 = join(tmp(), 'argv.json'); const e1 = engine({ FAKE_CLAUDE_ARGV_FILE: f1 }); const s1 = await start(e1, { permissionMode: 'bypassPermissions' }); const evs = [] as NormalisedEvent[];
    await s1.send('go'); await until(s1, (x) => x.type === 'text.delta', evs); await s1.interrupt(); const a1 = JSON.parse(readFileSync(f1, 'utf8')) as string[];
    expect(a1[a1.indexOf('--permission-mode') + 1]).toBe('manual'); expect(evs.find((x) => x.type === 'engine.warning')).toMatchObject({ code: 'bypass_not_allowed' });
    const f2 = join(tmp(), 'argv.json'); const e2 = engine({ FAKE_CLAUDE_ARGV_FILE: f2 }); const s2 = await start(e2, { permissionMode: 'bypassPermissions', allowBypass: true }); await s2.send('go'); await until(s2, (x) => x.type === 'text.delta'); await s2.interrupt();
    expect((JSON.parse(readFileSync(f2, 'utf8')) as string[])).toContain('bypassPermissions');
    const f3 = join(tmp(), 'argv.json'); const e3 = engine({ FAKE_CLAUDE_ARGV_FILE: f3 }); const s3 = await start(e3); s3.setPermissionMode?.('bypassPermissions'); await s3.send('go'); await until(s3, (x) => x.type === 'text.delta'); await s3.interrupt(); // a later change is the person's own call
    expect((JSON.parse(readFileSync(f3, 'utf8')) as string[])).toContain('bypassPermissions');
  });
  it('a version outside the supported range stops the turn before anything is spawned, unless unsupportedOk', async () => {
    const f = join(tmp(), 'argv.json'); const old = engine({ FAKE_CLAUDE_VERSION: '1.0.3 (Claude Code)', FAKE_CLAUDE_ARGV_FILE: f }, { versionProbe: claudeVersionProbe(FAKE) });
    // the probe runs the fake with --version in this process's environment, so the old version is set there too
    process.env.FAKE_CLAUDE_VERSION = '1.0.3 (Claude Code)';
    try {
      const s = await start(old); await s.send('hi'); const evs = await until(s, (x) => x.type === 'turn.done');
      expect(evs.find((x) => x.type === 'error')).toMatchObject({ code: 'provider_version_unsupported', fatal: true }); expect(evs.at(-1)).toMatchObject({ outcome: 'error', stop_reason: 'version_unsupported' });
      expect(() => readFileSync(f)).toThrow(); // never spawned
      const ok = engine({ FAKE_CLAUDE_ARGV_FILE: f }, { versionProbe: claudeVersionProbe(FAKE), unsupportedOk: true }); const s2 = await start(ok); await s2.send('hi'); await until(s2, (x) => x.type === 'text.delta'); expect(JSON.parse(readFileSync(f, 'utf8')).length).toBeGreaterThan(3); await s2.interrupt();
    } finally { delete process.env.FAKE_CLAUDE_VERSION; }
  });
  it('a version inside the range, or one that cannot be read, goes ahead', async () => {
    const e = engine({}, { versionProbe: claudeVersionProbe(FAKE) }); const s = await start(e); await s.send('hi'); await until(s, (x) => x.type === 'text.delta'); await s.interrupt();
    const e2 = engine({}, { versionProbe: async () => undefined }); const s2 = await start(e2); await s2.send('hi'); await until(s2, (x) => x.type === 'text.delta'); await s2.interrupt();
  });
});
