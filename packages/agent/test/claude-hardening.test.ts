import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AsyncQueue, ClaudeCodeEngine, ClaudeStreamParser, EVENT_QUEUE_MAX, EventStreamValidator, buildArgv, type EventBody, type NormalisedEvent } from '../src/index.js';

const fixture = (n: string) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8').split('\n').filter(Boolean);
async function collect(it: AsyncIterable<NormalisedEvent>, until: (e: NormalisedEvent) => boolean): Promise<NormalisedEvent[]> { const out: NormalisedEvent[] = []; for await (const e of it) { out.push(e); if (until(e)) break; } return out; }
afterEach(() => { vi.useRealTimers(); });

/** A fake `claude` process that keeps what was written to its stdin. */
function fakeProcess(lines: string[], o: { hang?: boolean; code?: number } = {}) {
  const calls: { args: string[]; stdin: string; opts: any }[] = [];
  const spawn = ((_bin: string, args: string[], opts: any) => {
    const child = new EventEmitter() as any; child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough(); child.pid = undefined;
    const call = { args, stdin: '', opts }; calls.push(call); child.stdin.on('data', (d: Buffer) => { call.stdin += d.toString(); });
    child.kill = (sig = 'SIGTERM') => { setImmediate(() => child.emit('close', null, sig)); return true; };
    child.stdin.on('end', () => { if (o.hang) return; setImmediate(() => { for (const l of lines) child.stdout.write(l + '\n'); child.stdout.end(); setImmediate(() => child.emit('close', o.code ?? 0, null)); }); });
    return child;
  }) as never;
  return { spawn, calls };
}

describe('the prompt goes in over stdin (lane C102)', () => {
  it('argv carries the flags and not the prompt; the whole prompt arrives on stdin, even 300 KiB of it', async () => {
    const f = fakeProcess(fixture('claude-ok.jsonl')); const s = await new ClaudeCodeEngine({ spawn: f.spawn }).start({ agentId: 'a', cwd: '/' });
    const prompt = 'secret-token-in-a-prompt ' + 'x'.repeat(300 * 1024); await s.send(prompt); await collect(s.events, (e) => e.type === 'turn.done');
    expect(f.calls[0]!.args[0]).toBe('-p'); expect(f.calls[0]!.args[1]).toBe('--output-format'); expect(f.calls[0]!.args.join(' ')).not.toContain('secret-token'); expect(f.calls[0]!.stdin).toBe(prompt); expect(f.calls[0]!.opts.stdio[0]).toBe('pipe');
  });
  it('the old form with the prompt on the command line is still available to callers that ask for it', () => { expect(buildArgv('hi', {})[1]).toBe('hi'); expect(buildArgv('hi', { viaStdin: true })).not.toContain('hi'); });
  it('a variadic flag before the end of the list cannot swallow the prompt: --allowedTools is followed by another flag, not by text', () => {
    const a = buildArgv('x', { viaStdin: true, allowedTools: ['Read', 'Bash(git diff *)'], permissionMode: 'plan' }); const i = a.indexOf('--allowedTools'); expect(a.slice(i + 1, i + 3)).toEqual(['Read', 'Bash(git diff *)']); expect(a.slice(-2)).not.toContain('x');
  });
});

describe('a CLI that says nothing is stopped (first-event timeout)', () => {
  it('after first_event_timeout_ms with no output the turn ends as a fatal error and the process is killed', async () => {
    vi.useFakeTimers(); const f = fakeProcess([], { hang: true }); const s = await new ClaudeCodeEngine({ spawn: f.spawn }).start({ agentId: 'a', cwd: '/', limits: { first_event_timeout_ms: 5000 } });
    const evs: NormalisedEvent[] = []; void (async () => { for await (const e of s.events) evs.push(e); })();
    await s.send('hi'); await vi.advanceTimersByTimeAsync(4900); expect(evs.some((e) => e.type === 'error')).toBe(false); await vi.advanceTimersByTimeAsync(200);
    expect(evs.find((e) => e.type === 'error')).toMatchObject({ code: 'provider_protocol_error', fatal: true }); expect((evs.find((e) => e.type === 'error') as any).tool_message).toContain('5 seconds');
    expect(evs.at(-1)).toMatchObject({ type: 'turn.done', outcome: 'error', stop_reason: 'first_event_timeout' }); const v = new EventStreamValidator('claude-code'); for (const e of evs) v.check(e); v.end();
  });
  it('the timer stops with the first line of output: a slow turn after that is never cut', async () => {
    vi.useFakeTimers(); const f = fakeProcess([], { hang: true }); const eng = new ClaudeCodeEngine({ spawn: ((...a: unknown[]) => { const c = (f.spawn as any)(...a); setImmediate(() => c.stdout.write(fixture('claude-ok.jsonl')[0] + '\n')); return c; }) as never });
    const s = await eng.start({ agentId: 'a', cwd: '/', limits: { first_event_timeout_ms: 5000 } }); const evs: NormalisedEvent[] = []; void (async () => { for await (const e of s.events) evs.push(e); })();
    await s.send('hi'); await vi.advanceTimersByTimeAsync(60_000); expect(evs.some((e) => e.type === 'error')).toBe(false); expect(evs.some((e) => e.type === 'session.started')).toBe(true);
  });
});

describe('sub-agents start when they are asked for and always finish (lane C102)', () => {
  const line = (o: unknown) => JSON.stringify(o);
  const taskCall = (id: string) => [
    line({ type: 'stream_event', event: { type: 'message_start', message: { id: 'msg_t' + id } } }),
    line({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id, name: 'Task', input: {} } } }),
    line({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"description":"Find the failing test","subagent_type":"general-purpose","prompt":"look"}' } } }),
    line({ type: 'stream_event', event: { type: 'content_block_stop', index: 0 } }),
    line({ type: 'stream_event', event: { type: 'message_stop' } }),
  ];
  const resultOf = (id: string, err = false) => line({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'done', is_error: err }] } });
  const run = (lines: string[]) => { const p = new ClaudeStreamParser(); const out: EventBody[] = lines.flatMap((l) => p.push(l)); return { out, p }; };
  it('a Task call starts a sub-agent labelled with its description, and its result finishes it', () => {
    const { out } = run([...taskCall('toolu_a'), resultOf('toolu_a')]); const types = out.map((e) => e.type);
    expect(out.find((e) => e.type === 'subagent.started')).toMatchObject({ subagent_id: 'toolu_a', parent_tool_id: 'toolu_a', label: 'Find the failing test' });
    expect(out.find((e) => e.type === 'subagent.done')).toMatchObject({ subagent_id: 'toolu_a', status: 'ok' }); expect(types.indexOf('tool.requested')).toBeLessThan(types.indexOf('subagent.started')); expect(types.indexOf('tool.result')).toBeLessThan(types.indexOf('subagent.done'));
  });
  it('an error result finishes it as error, and talking while it runs does not start it twice', () => {
    const child = line({ type: 'stream_event', parent_tool_use_id: 'toolu_b', event: { type: 'content_block_start', index: 1, content_block: { type: 'text' } } }); const delta = line({ type: 'stream_event', parent_tool_use_id: 'toolu_b', event: { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'hmm' } } });
    const { out } = run([...taskCall('toolu_b'), child, delta, resultOf('toolu_b', true)]); expect(out.filter((e) => e.type === 'subagent.started')).toHaveLength(1); expect(out.find((e) => e.type === 'subagent.text')).toBeTruthy(); expect(out.find((e) => e.type === 'subagent.done')).toMatchObject({ status: 'error' });
  });
  it('a turn that ends with a sub-agent still open closes it as canceled, before usage and turn.done', () => {
    const { out } = run([...taskCall('toolu_c'), line({ type: 'result', subtype: 'success', is_error: false, result: 'ok', usage: { input_tokens: 1, output_tokens: 1 } })]); const types = out.map((e) => e.type);
    expect(out.find((e) => e.type === 'subagent.done')).toMatchObject({ subagent_id: 'toolu_c', status: 'canceled' }); expect(types.indexOf('subagent.done')).toBeLessThan(types.indexOf('turn.done'));
  });
  it('through the engine: a process that exits with a sub-agent still open closes it and the whole stream passes the validator', async () => {
    const f = fakeProcess([fixture('claude-ok.jsonl')[0]!, ...taskCall('toolu_d')], { hang: false }); const s = await new ClaudeCodeEngine({ spawn: f.spawn }).start({ agentId: 'a', cwd: '/' });
    await s.send('delegate'); const evs = await collect(s.events, (e) => e.type === 'turn.done'); expect(evs.some((e) => e.type === 'subagent.done' && (e as any).status === 'canceled')).toBe(true);
    const v = new EventStreamValidator('claude-code'); for (const e of evs) v.check(e);
  });
});

describe('the stream validator accepts what the Claude adapter produces (lane C101)', () => {
  for (const name of ['claude-ok.jsonl', 'claude-tools.jsonl', 'claude-notloggedin.jsonl']) {
    it(`${name}: sequence numbers, tools, text and the end of the turn follow the rules`, async () => {
      const f = fakeProcess(fixture(name)); const s = await new ClaudeCodeEngine({ spawn: f.spawn }).start({ agentId: 'a', cwd: '/' }); await s.send('go'); const evs = await collect(s.events, (e) => e.type === 'turn.done');
      const v = new EventStreamValidator('claude-code'); for (const e of evs) v.check(e); v.end(); expect(evs.at(-1)!.type).toBe('turn.done');
    });
  }
});

describe('a slow consumer does not make the queue grow without end (lane C101)', () => {
  it('a plain queue is unchanged; a bounded one merges, drops and keeps as told', async () => {
    const plain = new AsyncQueue<number>(); for (let i = 0; i < 100; i++) expect(plain.push(i)).toBe('queued'); expect(plain.size).toBe(100);
    const q = new AsyncQueue<{ k: string; n: number }>({ max: 3, merge: (l, n) => l.k === 'text' && n.k === 'text' && ((l.n += n.n), true), droppable: (v) => v.k === 'chatter' });
    expect(['text', 'chatter', 'keep'].map((k) => q.push({ k, n: 1 }))).toEqual(['queued', 'queued', 'queued']); // under the bound everything is queued
    expect(q.push({ k: 'chatter', n: 1 })).toBe('dropped'); expect(q.push({ k: 'keep', n: 1 })).toBe('queued'); expect(q.size).toBe(4); // a value that matters is never lost, even past the bound
    expect(q.push({ k: 'text', n: 1 })).toBe('queued'); expect(q.push({ k: 'text', n: 5 })).toBe('merged'); const seen: number[] = []; for await (const v of q) { if (v.k === 'text') seen.push(v.n); if (q.size === 0) break; } expect(seen).toEqual([1, 6]);
  });
  it('6,000 deltas and 6,000 chatter lines with nobody reading: the text is whole, the sequence has no gaps, one notice says what was skipped, the stream is valid', async () => {
    const u = (o: unknown) => JSON.stringify(o); const lines = [fixture('claude-ok.jsonl')[0]!, u({ type: 'stream_event', event: { type: 'message_start', message: { id: 'msg_big', usage: { input_tokens: 1 } } } })];
    const N = 6000; let expected = ''; for (let i = 0; i < N; i++) { const t = `w${i} `; expected += t; lines.push(u({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: t } } }), u({ type: 'rate_limit_event', rate_limit_info: { unifiedWindows: { five_hour: { utilization: 0.1, resetsAt: 1 } } } })); }
    lines.push(u({ type: 'stream_event', event: { type: 'message_stop' } }), u({ type: 'result', subtype: 'success', is_error: false, result: 'ok', usage: { input_tokens: 1, output_tokens: 1 } }));
    const f = fakeProcess(lines); const s = await new ClaudeCodeEngine({ spawn: f.spawn }).start({ agentId: 'a', cwd: '/' }); await s.send('go'); await new Promise((r) => setTimeout(r, 400)); // the consumer starts late
    const evs = await collect(s.events, (e) => e.type === 'turn.done'); const v = new EventStreamValidator('claude-code'); for (const e of evs) v.check(e); v.end();
    expect(evs.filter((e) => e.type === 'text.delta').map((e) => (e as any).text).join('')).toBe(expected); expect(evs.filter((e) => e.type === 'engine.warning' && (e as any).code === 'events_dropped')).toHaveLength(1);
    expect(evs.filter((e) => e.type === 'limits.report').length).toBeLessThan(N); expect(evs.length).toBeLessThan(EVENT_QUEUE_MAX + 100); expect(evs.at(-1)).toMatchObject({ type: 'turn.done', outcome: 'ok' });
  });
});
