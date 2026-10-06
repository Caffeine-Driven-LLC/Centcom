import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { DemoEngine } from '@centcom/agent';
import { buildPrompt, readStdin, runPrint } from '../src/print.js';

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
    expect(d).toMatchObject({ is_error: false, declined: [] }); expect(typeof d.result).toBe('string'); expect(d.session_id).toMatch(/^ses_/); expect(d.usage.input_tokens).toBeGreaterThan(0); expect(d.cost_is_estimate).toBe(true);
  });
  it('streams normalised events as JSON lines', async () => {
    const r = await run({ mode: 'bypassPermissions', format: 'stream-json' }); const evs = r.out.trim().split('\n').map((l) => JSON.parse(l));
    expect(evs.map((e) => e.type)).toContain('turn.done'); expect(evs.some((e) => e.type === 'text.delta')).toBe(true);
  });
  it('declines what needs an approval, says so on stderr and exits 3', async () => {
    const r = await run({ prompt: 'fix the failing test in the auth module', mode: 'default' });
    expect(r.code).toBe(3); expect(r.err).toMatch(/Declined \(needs approval\)/); expect(r.err).toMatch(/--dangerously-skip-permissions/);
  });
  it('lets accept-edits through for edits', async () => { const r = await run({ prompt: 'fix the failing test in the auth module', mode: 'acceptEdits', format: 'json' }); expect(JSON.parse(r.out).declined.some((d: string) => d.startsWith('Edit'))).toBe(false); });
  it('exits 2 with help when there is nothing to do', async () => { const r = await run({ prompt: '' }); expect(r.code).toBe(2); expect(r.err).toMatch(/centcom -p/); });
  it('combines the argument with piped input', async () => {
    expect(buildPrompt('summarise', 'a\nb')).toBe('summarise\n\na\nb'); expect(buildPrompt(undefined, ' only piped ')).toBe('only piped'); expect(buildPrompt('only arg', '')).toBe('only arg');
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
