import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { DemoEngine } from '@centcom/agent';
import { FakeEngine } from '@centcom/testkit';
import { buildPrompt, readStdin, runPrint } from '../src/print/index.js';

const sink = () => { const s = new PassThrough(); let t = ''; s.on('data', (c) => (t += c)); return { s, text: () => t }; };
const run = async (o: Partial<Parameters<typeof runPrint>[0]> = {}) => {
  const out = sink(), err = sink();
  const code = await runPrint({ engine: new DemoEngine({ speed: 300 }), demo: true, cwd: '/tmp', branch: '', version: 't', mode: 'default', prompt: 'find where isExpired is used', format: 'text', save: false, out: out.s, err: err.s, ...o });
  return { code, out: out.text(), err: err.text() };
};

describe('print mode', () => {
  it('prints the answer to stdout and exits 0', async () => { const r = await run({ mode: 'bypassPermissions' }); expect(r.code).toBe(0); expect(r.out.length).toBeGreaterThan(20); expect(r.err).toBe(''); });
  it('writes one JSON object with the result, usage and session id', async () => {
    const r = await run({ mode: 'bypassPermissions', format: 'json' }); const d = JSON.parse(r.out);
    expect(d).toMatchObject({ type: 'result', is_error: false, engine: 'fake' }); expect(typeof d.result).toBe('string'); expect(d.session_id).toMatch(/^ses_[0-9A-HJKMNP-TV-Z]{26}$/); expect(d.usage.input_tokens).toBeGreaterThan(0); expect(typeof d.duration_ms).toBe('number'); expect(r.out.trim().split('\n')).toHaveLength(1);
  });
  it('streams normalised events as JSON lines', async () => {
    const r = await run({ mode: 'bypassPermissions', format: 'stream-json' }); const evs = r.out.trim().split('\n').map((l) => JSON.parse(l));
    expect(evs.map((e) => e.type)).toContain('turn.done'); expect(evs.some((e) => e.type === 'text.delta')).toBe(true);
  });
  it('declines what needs an approval, says so on stderr and exits 3', async () => {
    const r = await run({ prompt: 'fix the failing test in the auth module', mode: 'default' });
    expect(r.code).toBe(3); expect(r.err).toMatch(/Declined \(needs approval\)/); expect(r.err).toMatch(/--allow/);
  });
  it('lets accept-edits through for edits', async () => { const r = await run({ prompt: 'fix the failing test in the auth module', mode: 'acceptEdits', format: 'json' }); expect(r.err).not.toMatch(/Declined \(needs approval\): Edit/); expect(JSON.parse(r.out).is_error).toBe(false); });
  it('exits 2 with help when there is nothing to do', async () => { const r = await run({ prompt: '' }); expect(r.code).toBe(2); expect(r.err).toMatch(/centcom -p/); });
  it('combines the argument with piped input', async () => {
    expect(buildPrompt('summarise', 'a\nb')).toBe('summarise\n\n```\na\nb\n```'); expect(buildPrompt('x', 'has ``` inside')).toBe('x\n\n````\nhas ``` inside\n````'); expect(buildPrompt(undefined, ' only piped ')).toBe('only piped'); expect(buildPrompt('only arg', '')).toBe('only arg');
    const s = new PassThrough(); s.end('hello'); expect(await readStdin(s)).toBe('hello');
  });
});

describe('ctrl+c in print mode (lane C030)', () => {
  it('stops the turn and exits 130; the partial answer was printed', async () => {
    const { EventEmitter } = await import('node:events'); const proc = new EventEmitter() as unknown as NodeJS.Process;
    const p = run({ engine: new DemoEngine({ speed: 1 }), proc }); await new Promise((r) => setTimeout(r, 300)); proc.emit('SIGINT');
    const r = await p; expect(r.code).toBe(130); expect(r.err).toContain('Interrupted.');
  });
});

describe('print mode contract (lane C050)', async () => {
  const { EXIT_CODES, exitCodeFor, streamLine, STDIN_CAP, InputTooLarge } = await import('../src/print/index.js');
  it('maps provider, limit, network and HTTP errors to the documented exit codes', () => {
    expect([exitCodeFor('provider_not_installed'), exitCodeFor('provider_not_signed_in'), exitCodeFor('provider_policy_blocked'), exitCodeFor('provider_method_disabled')]).toEqual([4, 4, 4, 4]);
    expect([exitCodeFor('provider_cap_reached'), exitCodeFor('provider_rate_limited'), exitCodeFor({ status: 429 })]).toEqual([5, 5, 5]);
    expect([exitCodeFor('provider_protocol_error'), exitCodeFor('provider_version_unsupported'), exitCodeFor({ status: 503 })]).toEqual([6, 6, 6]);
    expect([exitCodeFor('something_else'), exitCodeFor('timeout'), exitCodeFor('interrupted'), EXIT_CODES.denied, EXIT_CODES.usage]).toEqual([1, 124, 130, 3, 2]);
  });
  it('stream-json carries only normalised event names, redacted', () => {
    expect(streamLine({ v: 1, seq: 1, ts: 'x', agent_id: 'a', type: 'thinking.delta', message_id: 'm', text: 'hm' } as never)).toBeUndefined();
    const l = streamLine({ v: 1, seq: 2, ts: 'x', agent_id: 'a', type: 'text.delta', message_id: 'm', text: 'key sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAA' } as never)!; expect(JSON.parse(l).type).toBe('text.delta'); expect(l).not.toContain('sk-ant-api03');
  });
  it('a json run prints one result line; a stream-json run ends with it', async () => {
    const r = await run({ format: 'stream-json' }); const lines = r.out.trim().split('\n').map((l) => JSON.parse(l)); expect(lines.at(-1)).toMatchObject({ type: 'result', is_error: false });
    const allowed = new Set(['session.started', 'text.delta', 'text.done', 'tool.requested', 'tool.result', 'approval.requested', 'usage.report', 'turn.done', 'error', 'result']); for (const l of lines) expect(allowed.has(l.type), l.type).toBe(true);
  });
  it('more than 1 MiB of piped input is refused', async () => {
    const { PassThrough } = await import('node:stream'); const { readStdin } = await import('../src/print/index.js'); const s = new PassThrough(); const p = readStdin(s); s.write(Buffer.alloc(STDIN_CAP + 10, 97)); s.end();
    await expect(p).rejects.toBeInstanceOf(InputTooLarge); await expect(p).rejects.toThrow('Input is too large (max 1 MiB).');
  });
  it('--timeout stops a stuck run with 124 and a result line saying so', async () => {
    const r = await run({ engine: new DemoEngine({ speed: 1 }), format: 'json', timeoutS: 0.3 }); expect(r.code).toBe(124); expect(JSON.parse(r.out.trim().split('\n').at(-1)!)).toMatchObject({ is_error: true, error: { code: 'timeout' } });
  });
});

describe('secrets split across streamed pieces', () => {
  const SECRET = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789ABCDEF';
  const pieces = ['The key is ' + SECRET.slice(0, 20), SECRET.slice(20) + ' and that is all.'];
  it('is scrubbed per piece only if the pieces are cut in the middle of a word, which the hold-back avoids', async () => {
    const { redact } = await import('@centcom/protocol'); const { Holdback } = await import('../src/print/format.js');
    expect(pieces.map((p) => redact(p)).join('')).toContain(SECRET.slice(0, 20)); // the problem: each half alone looks harmless
    const h = new Holdback(); const out = pieces.map((p) => redact(h.push(p))).join('') + redact(h.flush());
    expect(out).not.toContain(SECRET.slice(0, 20)); expect(out).toContain('The key is '); expect(out).toContain(' and that is all.');
  });
  it('never loses or reorders text, and flush returns the unfinished last word', async () => {
    const { Holdback } = await import('../src/print/format.js'); const h = new Holdback(); const bits = ['Hel', 'lo wor', 'ld, how a', 're you', '?\nFine'];
    const got = bits.map((b) => h.push(b)).join('') + h.flush(); expect(got).toBe(bits.join('')); expect(h.push('abc')).toBe(''); expect(h.flush()).toBe('abc'); expect(h.flush()).toBe('');
  });
});

describe('print mode when the agent fails', () => {
  const failing = (code: string, message: string) => new FakeEngine({ script: { events: [{ type: 'status', state: 'thinking' }, { type: 'error', code: code as never, tool_message: message, fatal: true }], outcome: 'error' } });
  const CASES: [string, string, number][] = [['provider_cap_reached', 'You have used your plan for now.', 5], ['provider_rate_limited', 'Too many requests.', 5], ['provider_not_signed_in', 'Please sign in.', 4], ['provider_not_installed', 'claude was not found.', 4], ['provider_protocol_error', 'Could not read the reply.', 6]];
  it.each(CASES)('%s: exit %i, a JSON error with its code, and the message on stderr in text mode', async (code, message, exit) => {
    const j = await run({ engine: failing(code, message), format: 'json', prompt: 'hello' }); expect(j.code).toBe(exit);
    const d = JSON.parse(j.out.trim().split('\n').at(-1)!); expect(d).toMatchObject({ type: 'result', is_error: true, error: { code } }); expect(d.error.message).toContain(message.slice(0, 12));
    const t = await run({ engine: failing(code, message), format: 'text', prompt: 'hello' }); expect(t.code).toBe(exit); expect(t.err).toContain('Error:'); expect(t.err).toContain(message.slice(0, 12)); expect(t.out).not.toContain('Error:');
  });
  it('a secret in the error message never reaches stdout or stderr', async () => {
    const r = await run({ engine: failing('provider_protocol_error', 'bad reply, key sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789ABCDEF'), format: 'json', prompt: 'hello' });
    expect(r.out + r.err).not.toContain('abcdefghijklmnopqrstuvwxyz0123456789'); expect(r.out + r.err).toContain('bad reply');
  });
});

describe('print mode when the reader goes away (| head -1)', () => {
  it('stops quietly and exits 0 within a second, with no stack trace', async () => {
    const { Writable } = await import('node:stream'); const err = sink(); let writes = 0;
    const out = new Writable({ write(_c, _e, cb) { writes++; const e = Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }); cb(e); } });
    const t0 = Date.now(); const code = await runPrint({ engine: new DemoEngine({ speed: 30 }), demo: true, cwd: '/tmp', branch: '', version: 't', mode: 'default', prompt: 'find where isExpired is used', format: 'text', save: false, out: out as never, err: err.s });
    expect(code).toBe(0); expect(Date.now() - t0).toBeLessThan(1500); expect(writes).toBeGreaterThan(0); expect(err.text()).not.toMatch(/at \S+ \(|EPIPE|Unhandled/);
  });
});
