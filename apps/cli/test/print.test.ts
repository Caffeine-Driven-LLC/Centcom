import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { DemoEngine } from '@centcom/agent';
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
