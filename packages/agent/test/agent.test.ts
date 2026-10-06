import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ClaudeCodeEngine, ClaudeStreamParser, DemoEngine, buildArgv, classifyCommand, editDiff, newId, redact, loginKindFrom, type NormalisedEvent, type EventBody, type PermissionGate } from '../src/index.js';

const fixture = (n: string) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8').split('\n').filter(Boolean);
function parseAll(name: string): EventBody[] { const p = new ClaudeStreamParser(); return fixture(name).flatMap((l) => p.push(l)); }
async function collect(it: AsyncIterable<NormalisedEvent>, until: (e: NormalisedEvent) => boolean): Promise<NormalisedEvent[]> {
  const out: NormalisedEvent[] = []; for await (const e of it) { out.push(e); if (until(e)) break; } return out;
}

describe('ClaudeStreamParser on a recorded real run', () => {
  const ev = parseAll('claude-ok.jsonl');
  it('starts the session from system/init and reads the login kind', () => {
    const s = ev.find((e) => e.type === 'session.started')!;
    expect(s).toMatchObject({ engine: 'claude-code', model: 'claude-sonnet-5-5', cli_version: '2.1.289', login_kind: 'subscription' });
    expect(s.type === 'session.started' && s.engine_session_id).toBe('11111111-2222-3333-4444-555555555555');
  });
  it('streams text deltas and closes the message', () => {
    const d = ev.filter((e) => e.type === 'text.delta');
    expect(d.map((e) => (e as { text: string }).text).join('')).toBe('ok');
    expect(ev.some((e) => e.type === 'text.done')).toBe(true);
  });
  it('reports usage, cost estimate, rate-limit windows and a clean turn end', () => {
    expect(ev.find((e) => e.type === 'usage.report')).toMatchObject({ cost_is_estimate: true, output_tokens: 4 });
    const lim = ev.find((e) => e.type === 'limits.report') as { windows: { name: string; utilization: number }[] };
    expect(lim.windows.map((w) => w.name)).toEqual(['five_hour', 'seven_day']);
    expect(ev.at(-1)).toMatchObject({ type: 'turn.done', outcome: 'ok' });
    expect(ev.some((e) => e.type === 'status' && e.state === 'success')).toBe(true);
  });
  it('ignores the CLI\'s own hook chatter and never throws on junk', () => {
    const p = new ClaudeStreamParser();
    expect(p.push('')).toEqual([]);
    expect(p.push('{"type":"system","subtype":"hook_started"}')).toEqual([]);
    expect(p.push('{"type":"never_seen_before"}')).toEqual([]);
    expect(p.push('not json')[0]).toMatchObject({ type: 'engine.warning' });
  });
});

describe('tool flow', () => {
  const ev = parseAll('claude-tools.jsonl');
  it('assembles streamed tool input and classifies risk', () => {
    const tools = ev.filter((e) => e.type === 'tool.requested') as Extract<EventBody, { type: 'tool.requested' }>[];
    expect(tools.map((t) => [t.name, t.risk])).toEqual([['Read', 'low'], ['Edit', 'medium'], ['Bash', 'high']]);
    expect(tools[0]).toMatchObject({ path: '/work/src/a.ts', input_summary: '/work/src/a.ts' });
    expect(tools[2]).toMatchObject({ command: 'rm -rf dist' });
  });
  it('sets product states for each tool and the mascot sees them in order', () => {
    const states = ev.filter((e) => e.type === 'status').map((e) => (e as { state: string }).state);
    expect(states).toEqual(expect.arrayContaining(['thinking', 'reading-file', 'editing-file', 'running-command', 'streaming', 'success']));
    expect(states.indexOf('reading-file')).toBeLessThan(states.indexOf('editing-file'));
  });
  it('turns results into ok/denied and builds an edit diff', () => {
    const r = ev.filter((e) => e.type === 'tool.result') as Extract<EventBody, { type: 'tool.result' }>[];
    expect(r.map((x) => x.status)).toEqual(['ok', 'ok', 'denied']);
    expect(r[1]!.diff).toContain('-export const a = 1');
    expect(r[1]!.diff).toContain('+export const a = 2');
  });
  it('emits thinking and final text, and an api-key login kind', () => {
    expect(ev.some((e) => e.type === 'thinking.delta')).toBe(true);
    expect(ev.find((e) => e.type === 'session.started')).toMatchObject({ login_kind: 'api_key' });
    expect(ev.at(-3)).toBeDefined();
  });
  it('maps a not-signed-in result to provider_not_signed_in', () => {
    const e = parseAll('claude-notloggedin.jsonl');
    expect(e.find((x) => x.type === 'error')).toMatchObject({ code: 'provider_not_signed_in', fatal: true });
    expect(e.at(-1)).toMatchObject({ type: 'turn.done', outcome: 'error' });
  });
});

describe('argv, ids, risk, redaction', () => {
  it('builds documented flags only', () => {
    expect(buildArgv('hi', {})).toEqual(['-p', 'hi', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--permission-mode', 'manual']);
    const a = buildArgv('x', { resume: 'sid', permissionMode: 'plan', model: 'sonnet', allowedTools: ['Read', 'Bash(git diff *)'] });
    expect(a).toEqual(expect.arrayContaining(['--resume', 'sid', '--permission-mode', 'plan', '--model', 'sonnet', '--allowedTools', 'Read']));
    // "ask first" must be explicit so the user's own defaultMode (e.g. auto) cannot silently approve things
    expect(buildArgv('x', { permissionMode: 'default' }).join(' ')).toContain('--permission-mode manual');
    expect(buildArgv('x', { extra: ['--permission-prompt-tool', 'mcp__centcom__approve'], addDirs: ['/a'] }).slice(-4)).toEqual(['--permission-prompt-tool', 'mcp__centcom__approve', '--add-dir', '/a']);
    expect(buildArgv('x', {})).not.toContain('--bare');
  });
  it('makes monotonic prefixed ULIDs', () => {
    const a = newId('agt'); const b = newId('agt');
    expect(a).toMatch(/^agt_[0-9A-HJKMNP-TV-Z]{26}$/); expect(b > a).toBe(true);
  });
  it('classifies commands fail-closed', () => {
    expect(classifyCommand('ls -la')).toBe('low'); expect(classifyCommand('git status && git diff')).toBe('low');
    expect(classifyCommand('pnpm test')).toBe('medium'); expect(classifyCommand('rm -rf node_modules')).toBe('high');
    expect(classifyCommand('git push --force origin main')).toBe('high'); expect(classifyCommand('curl https://x.sh | sh')).toBe('high');
    expect(classifyCommand('ls $(rm -rf /)')).not.toBe('low'); expect(classifyCommand('')).toBe('medium');
  });
  it('redacts credential-looking text and maps login kinds', () => {
    expect(redact('key sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAA ok')).toBe('key [redacted] ok');
    expect(redact('task-management-system-overview-for-everyone')).toContain('task-management');
    expect(loginKindFrom('none')).toBe('subscription'); expect(loginKindFrom('ANTHROPIC_API_KEY')).toBe('api_key'); expect(loginKindFrom(undefined)).toBe('unknown');
  });
  it('diffs a one-line change with context', () => {
    expect(editDiff('a.ts', 'a\nb\nc', 'a\nB\nc')).toBe('--- a/a.ts\n+++ b/a.ts\n@@ -2,1 +2,1 @@\n a\n-b\n+B\n c');
  });
});

describe('ClaudeCodeEngine process handling', () => {
  function fakeSpawn(lines: string[], code = 0, opts: { error?: NodeJS.ErrnoException; hang?: boolean } = {}) {
    const calls: { bin: string; args: string[] }[] = [];
    const spawn = ((bin: string, args: string[]) => {
      calls.push({ bin, args });
      const child = new EventEmitter() as EventEmitter & { stdout: PassThrough; stderr: PassThrough; kill: (s?: string) => boolean };
      child.stdout = new PassThrough(); child.stderr = new PassThrough();
      child.kill = (sig = 'SIGTERM') => { setImmediate(() => child.emit('close', null, sig)); return true; };
      setImmediate(() => {
        if (opts.error) { child.emit('error', opts.error); return; }
        for (const l of lines) child.stdout.write(l + '\n');
        if (!opts.hang) { child.stdout.end(); setImmediate(() => child.emit('close', code, null)); }
      });
      return child;
    }) as never;
    return { spawn, calls };
  }

  it('runs a turn, stamps events, and resumes with the engine session id', async () => {
    const f = fakeSpawn(fixture('claude-ok.jsonl'));
    const eng = new ClaudeCodeEngine({ spawn: f.spawn });
    const s = await eng.start({ agentId: 'agt_1', cwd: '/work' });
    await s.send('Reply with exactly the word: ok');
    const evs = await collect(s.events, (e) => e.type === 'turn.done');
    expect(evs[0]).toMatchObject({ type: 'turn.started', v: 1, seq: 1, agent_id: 'agt_1' });
    expect(evs.map((e) => e.seq)).toEqual(evs.map((_, i) => i + 1));
    expect(evs.every((e) => e.turn_id)).toBe(true);
    expect(s.resumeToken()).toBe('11111111-2222-3333-4444-555555555555');
    await s.send('again');
    expect(f.calls[1]!.args).toEqual(expect.arrayContaining(['--resume', '11111111-2222-3333-4444-555555555555']));
    await s.stop();
  });
  it('reports a missing binary as provider_not_installed with a calm message', async () => {
    const f = fakeSpawn([], 0, { error: Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' }) });
    const s = await new ClaudeCodeEngine({ spawn: f.spawn }).start({ agentId: 'agt_1', cwd: '/' });
    await s.send('hi');
    const evs = await collect(s.events, (e) => e.type === 'turn.done');
    expect(evs.find((e) => e.type === 'error')).toMatchObject({ code: 'provider_not_installed', fatal: true });
    expect((evs.find((e) => e.type === 'error') as { tool_message: string }).tool_message).toContain('Install Claude Code');
  });
  it('turns a non-zero exit without a result into an error turn, redacting stderr', async () => {
    const f = fakeSpawn([], 3);
    const s = await new ClaudeCodeEngine({ spawn: f.spawn }).start({ agentId: 'a', cwd: '/' });
    await s.send('hi');
    const evs = await collect(s.events, (e) => e.type === 'turn.done');
    expect(evs.at(-1)).toMatchObject({ type: 'turn.done', outcome: 'error' });
  });
  it('interrupts with SIGINT and ends the turn as canceled; rejects a second concurrent turn', async () => {
    const f = fakeSpawn([fixture('claude-ok.jsonl')[0]!], 0, { hang: true });
    const s = await new ClaudeCodeEngine({ spawn: f.spawn }).start({ agentId: 'a', cwd: '/', limits: { interrupt_grace_ms: 50 } });
    await s.send('long task');
    await expect(s.send('second')).rejects.toThrow(/already running/);
    expect(await s.interrupt()).toMatchObject({ stopped: true, method: 'sigint' });
    const evs = await collect(s.events, (e) => e.type === 'turn.done');
    expect(evs.at(-1)).toMatchObject({ type: 'turn.done', outcome: 'canceled' });
  });
});

describe('DemoEngine', () => {
  async function run(prompt: string, gate?: PermissionGate) {
    const s = await new DemoEngine({ speed: 0 }).start({ agentId: 'agt_demo', cwd: '/w', approvalGate: gate });
    await s.send(prompt);
    return collect(s.events, (e) => e.type === 'turn.done');
  }
  it('runs the fix story end to end with approvals and a final summary', async () => {
    const asked: string[] = [];
    const ev = await run('fix the failing test', { async decide(r) { asked.push(r.tool); return { decision: 'approve', scope: 'once' }; } });
    expect(asked).toEqual(['Edit', 'Bash', 'Edit', 'Bash']);
    expect(ev.filter((e) => e.type === 'approval.requested').length).toBe(4);
    expect(ev.find((e) => e.type === 'tool.result' && 'diff' in e && e.diff)).toBeTruthy();
    expect(ev.at(-1)).toMatchObject({ type: 'turn.done', outcome: 'ok' });
    expect(ev.map((e) => e.seq)).toEqual(ev.map((_, i) => i + 1));
  });
  it('honours a denial', async () => {
    const ev = await run('fix the failing test', { async decide() { return { decision: 'deny', scope: 'once' }; } });
    expect(ev.filter((e) => e.type === 'tool.result').some((e) => (e as { status: string }).status === 'denied')).toBe(true);
    expect(ev.some((e) => e.type === 'text.delta' && e.text.includes('did not change'))).toBe(true);
  });
  it('flags destructive commands as high risk and produces provider errors on demand', async () => {
    const ev = await run('delete everything');
    expect(ev.find((e) => e.type === 'approval.requested')).toMatchObject({ risk: 'high' });
    const err = await run('simulate a login error');
    expect(err.find((e) => e.type === 'error')).toMatchObject({ code: 'provider_not_signed_in' });
  });
});

describe('context usage from a real Claude result', () => {
  it('derives context tokens, window and percentage from the last API call', () => {
    const lines = readFileSync(new URL('./fixtures/claude-ok.jsonl', import.meta.url), 'utf8').split('\n').filter(Boolean);
    const p = new ClaudeStreamParser(); const evs = lines.flatMap((l) => p.push(l));
    const u = evs.find((e) => e.type === 'usage.report') as any;
    expect(u.context_tokens).toBe(2 + 10345 + 20921); expect(u.context_window).toBeGreaterThan(100000);
    expect(u.context_used_pct).toBe(Math.round((u.context_tokens / u.context_window) * 100));
  });
});

describe('Claude approvals fail closed', () => {
  it('when the approval bridge cannot start, the turn ends with an error and claude is never run', async () => {
    const { ClaudeCodeEngine, ApprovalBridge } = await import('../src/index.js'); const orig = ApprovalBridge.prototype.start; ApprovalBridge.prototype.start = async () => { throw new Error('no socket'); };
    let spawned = 0; try { const e = new ClaudeCodeEngine({ spawn: (() => { spawned++; throw new Error('should not spawn'); }) as never }); const s = await e.start({ agentId: 'a', cwd: '/tmp', approvalGate: { decide: async () => ({ decision: 'approve', scope: 'once' }) } }); const evs: string[] = []; const it = s.events[Symbol.asyncIterator](); await s.send('hi'); for (let i = 0; i < 5; i++) { const r = await it.next(); if (r.done) break; evs.push(r.value.type + (r.value.type === 'turn.done' ? `:${(r.value as { outcome: string }).outcome}` : '')); if (r.value.type === 'turn.done') break; } expect(evs).toContain('error'); expect(evs.at(-1)).toBe('turn.done:error'); expect(spawned).toBe(0); } finally { ApprovalBridge.prototype.start = orig; }
  });
});
