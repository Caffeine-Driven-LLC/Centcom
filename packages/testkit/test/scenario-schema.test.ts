import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ERROR_TABLE, EVENT_MODES, parseEventPayload } from '@centcom/protocol';
import { BUNDLED_SCENARIOS, MockInputError, SCENARIOS, loadScenario, parseScenario, validateScenario, type MockBackend } from '../src/index.js';
import { start } from './helpers.js';

let m: MockBackend | undefined; const dirs: string[] = [];
afterEach(async () => { await m?.stop(); m = undefined; dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })); });
const CARD = ['happy', 'resume-hot', 'resume-snapshot', 'forced-disconnect', 'ticket-expired', 'superseded', 'kicked', 'host-loss', 'slow-consumer', 'bad-frames', 'quota-warning', 'maintenance', 'client-too-old', 'overload-4503', 'errors', 'rate-limited'];
const issues = (x: unknown) => { const r = validateScenario(x); return r.ok ? [] : r.issues; };

describe('scenario files', () => {
  it('ships all 16 scenarios named on the card, each valid and named after its file', () => {
    for (const n of CARD) expect(BUNDLED_SCENARIOS, n).toContain(n);
    for (const n of BUNDLED_SCENARIOS) { expect(validateScenario(SCENARIOS[n]).ok, n).toBe(true); expect(SCENARIOS[n]!.name).toBe(n); }
  });
  it('errors raises every registry code exactly once', () => {
    const codes = SCENARIOS.errors!.steps.map((s) => s.args.code); expect([...codes].sort()).toEqual(Object.keys(ERROR_TABLE).sort());
  });
  it('clear payloads that bundled peers send validate against the event schemas', () => {
    for (const sc of Object.values(SCENARIOS)) for (const s of sc.steps) {
      if (s.do !== 'peer_send' || !s.args.p) continue; const k = String(s.args.k);
      if (k in EVENT_MODES && EVENT_MODES[k as keyof typeof EVENT_MODES] !== 'encrypted') expect(parseEventPayload(k, s.args.p).ok, `${sc.name} ${k}`).toBe(true);
    }
  });
  it('reports every violation with its JSON pointer', () => {
    const bad = issues({ name: 'Bad Name', extra: 1, steps: [
      { do: 'explode', args: {} },
      { at_ms: 1, on: { kind: 'sys.hello' }, do: 'drop', args: {} },
      { do: 'disconnect', args: { code: 1234, sid: 'nope' } },
      { do: 'notice', args: { code: 'usage_warning', params: { pct: 5 } } },
      { do: 'error', args: { code: 'not_a_code' } },
      { do: 'error', args: { code: 'forbidden', after: 3 } },
      { do: 'peer_send', args: { k: 'message.user', typo: true } },
      { at_ms: -5, do: 'drop' },
    ] });
    const ptrs = bad.map((i) => i.pointer);
    for (const p of ['', '/name', '/steps/0/do', '/steps/1', '/steps/2/args/code', '/steps/2/args/sid', '/steps/3/args/params', '/steps/4/args/code', '/steps/5/args/code', '/steps/6/args', '/steps/7/at_ms', '/steps/7']) expect(ptrs, p).toContain(p);
    expect(bad.find((i) => i.pointer === '')!.message).toContain('extra'); expect(bad.find((i) => i.pointer === '/steps/6/args')!.message).toContain('typo');
    expect(bad.find((i) => i.pointer === '/steps/7')!.message).toContain('args');
  });
  it('rejects non-JSON and unknown names; MockInputError lists the pointers', () => {
    expect(() => parseScenario('{nope', 'x.json')).toThrow(MockInputError);
    const e = (() => { try { parseScenario(JSON.stringify({ name: 'x', steps: [{ do: 'drop' }] }), 'x.json'); return undefined; } catch (x) { return x as MockInputError; } })();
    expect(e).toBeInstanceOf(MockInputError); expect(e!.issues[0]!.pointer).toBe('/steps/0'); expect(e!.message).toContain('/steps/0');
    expect(() => loadScenario('no-such-scenario')).toThrow(/unknown scenario/);
    const d = mkdtempSync(join(tmpdir(), 'sc-')); dirs.push(d); const f = join(d, 'mine.json'); writeFileSync(f, JSON.stringify({ name: 'mine', seed: 3, steps: [] }));
    expect(loadScenario(f)).toEqual({ name: 'mine', seed: 3, steps: [] });
  });
  it('startMockBackend, setScenario and POST /__mock/scenario refuse a malformed scenario and accept a good one', async () => {
    await expect(start({ scenario: { name: 'x', steps: [{ do: 'nope', args: {} }] } as never })).rejects.toThrow(MockInputError);
    m = await start(); expect(() => m!.setScenario({ name: 'x', steps: [{ do: 'drop' }] } as never)).toThrow(MockInputError);
    const bad = await fetch(`${m.httpUrl}/__mock/scenario`, { method: 'POST', body: JSON.stringify({ name: 'x', steps: [{ do: 'drop', args: { count: 0 } }] }) });
    expect(bad.status).toBe(400); expect(((await bad.json()) as { error: string }).error).toContain('/steps/0/args/count');
    const good = await fetch(`${m.httpUrl}/__mock/scenario`, { method: 'POST', body: JSON.stringify({ name: 'rate-limited' }) }); expect(await good.json()).toEqual({ name: 'rate-limited', steps: 1 });
  });
  it('the scenario seed is used when no seed is given', async () => {
    m = await start({ seed: undefined, scenario: 'happy' }); expect(m.seed).toBe(7); await m.stop();
    m = await start({ seed: 9, scenario: 'happy' }); expect(m.seed).toBe(9);
  });
});
