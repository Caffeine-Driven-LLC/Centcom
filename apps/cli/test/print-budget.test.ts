import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import type { EventBody } from '@centcom/agent';
import { FakeEngine } from '@centcom/testkit';
import { runPrint } from '../src/print/index.js';
import { exitCodeFor } from '../src/print/exit-codes.js';

const sink = () => { const s = new PassThrough(); let t = ''; s.on('data', (c) => (t += c)); return { s, text: () => t }; };
const clock = { now: () => Date.now(), setTimeout: (f: () => void, ms: number) => setTimeout(f, ms) };
const progress = (n: number): EventBody[] => Array.from({ length: n }, (_, i) => ({ type: 'usage.progress', message_id: `m${i}`, scope: 'main', input_tokens: 5, output_tokens: 100 }));

describe('print mode and the budget guard', () => {
  it('a run that passes a limit is stopped, nobody is asked, and it exits 5 with the reason', async () => {
    const out = sink(), err = sink(); const dir = mkdtempSync(join(tmpdir(), 'cc-pb-'));
    const code = await runPrint({ engine: new FakeEngine({ id: 'claude-code', clock, script: { events: progress(40), gapMs: 5, hang: true } }) as never, demo: false, cwd: '/tmp', branch: '', version: 't', mode: 'default', prompt: 'refactor everything', format: 'json', save: false, out: out.s, err: err.s, configDir: dir, dataDir: dir, budget: { runRequests: 5, runOutputTokens: 0, runUsd: 0 } });
    expect(code).toBe(5); const d = JSON.parse(out.text()); expect(d.is_error).toBe(true); expect(d.error.message).toContain('This run has made'); expect(d.error.message).toContain('budget.enabled'); expect(err.text()).toMatch(/budget guard/);
  });
  it('the budget code is the "limit" exit code', () => { expect(exitCodeFor('budget_reached')).toBe(5); });
  it('with the guard off the same run is not stopped', async () => {
    const out = sink(), err = sink(); const dir = mkdtempSync(join(tmpdir(), 'cc-pb-'));
    const code = await runPrint({ engine: new FakeEngine({ id: 'claude-code', clock, script: { events: progress(20) } }) as never, demo: false, cwd: '/tmp', branch: '', version: 't', mode: 'default', prompt: 'go', format: 'json', save: false, out: out.s, err: err.s, configDir: dir, dataDir: dir, budget: { enabled: false, runRequests: 5 } });
    expect(code).toBe(0);
  });
});
