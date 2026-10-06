import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { VirtualClock } from '@centcom/testkit';
import { EVENT_MODES, parseEventPayload, parseSecretPayload } from '@centcom/protocol';
import { EventStreamValidator, toSessionWire, type NormalisedEvent, type WireContext } from '../../src/index.js';
import { createFakeEngine, expectGolden, loadTranscript, parseTranscript, replayTranscript } from '../../src/engine/testing/index.js';

const DIR = fileURLToPath(new URL('../fixtures/transcripts/', import.meta.url)); const NAMES = readdirSync(DIR).filter((f) => f.endsWith('.transcript.jsonl')).map((f) => f.replace('.transcript.jsonl', '')).sort();
const play = async (name: string, speed = 0) => { const clock = new VirtualClock(); const t = loadTranscript(join(DIR, `${name}.transcript.jsonl`)); return replayTranscript(createFakeEngine(t, { clock, speed }), t); };
const ctx: WireContext = { agentId: 'agt_01JTEST0000000000000000001', messageId: (m) => m, approverFor: () => 'host', approvalTtlMs: 600_000, now: () => new Date('2026-10-06T00:00:00Z') };

describe('golden transcripts', () => {
  it('ships exactly the 6 transcripts', () => { expect(NAMES).toEqual(['approval', 'fatal-error', 'interrupt', 'parallel-subagent', 'text-only', 'tool-read']); });
  it.each(NAMES)('%s: events match the golden file, pass the stream validator and are deterministic', async (name) => {
    const a = await play(name); const b = await play(name); expect(b).toEqual(a); expectGolden(a, join(DIR, `${name}.golden.json`));
    const v = new EventStreamValidator('fake'); for (const e of a) v.check(e); v.end(); expect(a[0]!.type).toBe('session.started'); expect(a.map((e) => e.seq)).toEqual(a.map((_e, i) => i + 1));
  });
  it.each(NAMES)('%s: every wire event validates against the contract (clear part and secret part)', async (name) => {
    let n = 0; for (const e of await play(name)) for (const o of toSessionWire(e, { ...ctx, messageId: (m) => m })) { n++; if (o.p) expect(parseEventPayload(o.k, o.p).ok, `${o.k} ${JSON.stringify(o.p)}`).toBe(true); if (o.ct) expect(parseSecretPayload(o.k, o.ct).ok, `${o.k} ${JSON.stringify(o.ct)}`).toBe(true); const mode = (EVENT_MODES as Record<string, string>)[o.k]; if (mode === 'encrypted') expect(o.p).toBeUndefined(); }
    expect(n).toBeGreaterThan(0);
  });
  it('all 6 transcripts replay in under a second with speed 0', async () => { const t0 = Date.now(); for (const n of NAMES) await play(n); expect(Date.now() - t0).toBeLessThan(1000); });
});

describe('approval and interrupt behaviour', () => {
  it('the approval transcript pauses after approval.requested until the gate answers, then resolves by user and continues', async () => {
    const clock = new VirtualClock(); const t = loadTranscript(join(DIR, 'approval.transcript.jsonl')); const eng = createFakeEngine(t, { clock });
    let answer!: (d: { decision: 'approve' | 'deny'; scope: 'once' }) => void; const gate = { decide: () => new Promise<{ decision: 'approve' | 'deny'; scope: 'once' }>((r) => { answer = r; }) };
    const s = await eng.start({ agentId: 'agt_01JTEST0000000000000000001', cwd: '/tmp', approvalGate: gate }) as any; const seen: NormalisedEvent[] = []; void (async () => { for await (const e of s.events) seen.push(e); })();
    await s.send('fix the typo'); await new Promise((r) => setTimeout(r, 30)); expect(seen.at(-1)!.type).toBe('approval.requested'); expect(seen.some((e) => e.type === 'approval.resolved')).toBe(false);
    answer({ decision: 'approve', scope: 'once' }); await s.finished; const resolved = seen.find((e) => e.type === 'approval.resolved') as any; expect(resolved.by).toBe('user'); expect(seen.at(-1)!.type).toBe('turn.done'); expect(seen.findIndex((e) => e.type === 'tool.result')).toBeGreaterThan(seen.indexOf(resolved));
  });
  it('a gate that throws, or an answer that differs from the transcript, is reported (fail closed)', async () => {
    const t = loadTranscript(join(DIR, 'approval.transcript.jsonl')); const clock = new VirtualClock(); const eng = createFakeEngine(t, { clock });
    const s = await eng.start({ agentId: 'agt_01JTEST0000000000000000001', cwd: '/tmp', approvalGate: { decide: async () => { throw new Error('boom'); } } }) as any; const seen: any[] = []; void (async () => { for await (const e of s.events) seen.push(e); })(); await s.send('fix the typo'); await s.finished;
    expect(seen.find((e) => e.type === 'approval.resolved')).toMatchObject({ decision: 'deny', by: 'user' }); expect(s.failure.message).toContain('expects approve, the gate said deny');
  });
  it('interrupt mid-tool with a pending approval emits approval.resolved(interrupt), tool.result(canceled), turn.done(canceled) in that order, and nothing after', async () => {
    const ev = await play('interrupt'); const tail = ev.slice(-3); expect(tail.map((e) => e.type)).toEqual(['approval.resolved', 'tool.result', 'turn.done']);
    expect(tail[0]).toMatchObject({ by: 'interrupt', decision: 'deny' }); expect(tail[1]).toMatchObject({ status: 'canceled' }); expect(tail[2]).toMatchObject({ outcome: 'canceled' }); expect(ev.some((e) => e.type === 'text.delta')).toBe(false);
    expect(new Date(tail[2]!.ts).getTime() - new Date(tail[0]!.ts).getTime()).toBeLessThanOrEqual(50);
  });
  it('with speed 1 the recorded timing is honoured on the injected clock', async () => {
    const clock = new VirtualClock(); const t = loadTranscript(join(DIR, 'text-only.transcript.jsonl')); const p = replayTranscript(createFakeEngine(t, { clock, speed: 1 }), t); let done = false; void p.then(() => { done = true; });
    await clock.advance(50); await new Promise((r) => setTimeout(r, 20)); expect(done).toBe(false); await clock.advance(500); await new Promise((r) => setTimeout(r, 20)); await clock.advance(500); const ev = await p; expect(done).toBe(true); expect(new Date(ev.at(-1)!.ts).getTime()).toBeGreaterThan(new Date(ev[0]!.ts).getTime());
  });
});

describe('transcript parsing and golden behaviour', () => {
  it('an unknown expect step fails with the line number; so do bad JSON and a missing header', () => {
    expect(() => parseTranscript('{"transcript":1,"engine":"fake"}\n{"expect":"wave"}\n', 't.jsonl')).toThrow('t.jsonl:2: unknown expect step "wave"'); expect(() => parseTranscript('{"transcript":1,"engine":"fake"}\n{oops\n', 't')).toThrow('t:2: not valid JSON'); expect(() => parseTranscript('{"at_ms":1,"event":{"type":"x"}}\n', 't')).toThrow('t:1');
    expect(() => parseTranscript('', 't')).toThrow('empty');
  });
  it('a wrong prompt in a send step fails the replay', async () => {
    const t = parseTranscript('{"transcript":1,"engine":"fake"}\n{"at_ms":0,"event":{"type":"session.started","engine":"fake","engine_session_id":"s","model":"m","tools":[],"mcp_servers":[],"capabilities":[],"login_kind":"unknown"}}\n{"expect":"send","prompt":"A"}\n'); const clock = new VirtualClock(); const eng = createFakeEngine(t, { clock });
    const s = await eng.start({ agentId: 'agt_01JTEST0000000000000000001', cwd: '/tmp' }) as any; await s.send('B'); await s.finished; expect(s.failure.message).toContain('expected prompt "A", got "B"'); await expect(replayTranscript(createFakeEngine(t, { clock }), t, { driver: async (x) => { await x.send('B'); } })).rejects.toThrow('got "B"');
  });
  it('expectGolden fails on a difference and on a missing file, and UPDATE_GOLDEN=1 rewrites', async () => {
    const saved = process.env.UPDATE_GOLDEN; delete process.env.UPDATE_GOLDEN; const { mkdtempSync, writeFileSync, readFileSync } = await import('node:fs'); const { tmpdir } = await import('node:os'); const f = join(mkdtempSync(join(tmpdir(), 'gold-')), 'x.golden.json');
    expect(() => expectGolden([{ a: 1 }], f)).toThrow('does not exist'); process.env.UPDATE_GOLDEN = '1'; try { expectGolden([{ a: 1 }], f); } finally { delete process.env.UPDATE_GOLDEN; } expect(readFileSync(f, 'utf8')).toContain('"a": 1'); expect(() => expectGolden([{ a: 1 }], f)).not.toThrow(); expect(() => expectGolden([{ a: 2 }], f)).toThrow('differ'); void writeFileSync; if (saved !== undefined) process.env.UPDATE_GOLDEN = saved;
  });
});
