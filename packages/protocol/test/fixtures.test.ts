import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EVENT_MODES, assertWritableEventPayload, assertWritableFrame, assertWritableSecretPayload, parseEventPayload, parseFrame, payloadMode, validateAgainst, type EventKind } from '../src/index.js';

const FIX = join(__dirname, '../../../contracts/fixtures');
const walk = (d: string): string[] => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : p.endsWith('.json') ? [p] : []; });
const top = (p: string) => relative(FIX, p).split(sep)[0];
const all = walk(FIX).filter((p) => top(p) !== 'crypto'); const rel = (p: string) => relative(FIX, p);
const events = all.filter((p) => top(p) === 'events'); const others = all.filter((p) => top(p) !== 'events');

describe('every fixture in contracts/fixtures is checked (new ones are picked up automatically)', () => {
  it('found the corpus', () => { expect(events.length).toBeGreaterThanOrEqual(45); expect(others.length).toBeGreaterThanOrEqual(30); });

  for (const f of others) {
    const j = JSON.parse(readFileSync(f, 'utf8'));
    if (!j.schema) { it(`${rel(f)}: is a data fixture and its patterns compile`, () => { expect(j.note).toBeTruthy(); for (const x of j.patterns ?? []) expect(() => new RegExp(x.regex, 'u')).not.toThrow(); }); continue; }
    it(`${rel(f)}: ${j.valid ? 'valid' : 'invalid'} against ${j.schema}`, () => {
      const r = validateAgainst(j.schema, j.data, 'strict'); expect(r.ok).toBe(!!j.valid);
      if (!j.valid && !r.ok) expect(r.issues.length).toBeGreaterThan(0);
    });
  }

  for (const f of events) {
    const j = JSON.parse(readFileSync(f, 'utf8'));
    it(`${rel(f)}: frame and payloads`, () => {
      expect(parseFrame(j.frame)).toMatchObject({ ok: true }); expect(() => assertWritableFrame(j.frame)).not.toThrow();
      const mode = payloadMode(j.kind); expect(mode).not.toBe('unknown');
      if (j.frame.p !== undefined && mode !== 'encrypted') { expect(parseEventPayload(j.kind, j.frame.p)).toMatchObject({ ok: true }); expect(() => assertWritableEventPayload(j.kind as EventKind, j.frame.p)).not.toThrow(); }
      if (j.secret !== undefined) expect(() => assertWritableSecretPayload(j.kind as EventKind, j.secret)).not.toThrow();
    });
  }

  it('the event kinds derived from the schema are exactly the kinds the fixtures use', () => {
    const fixtureKinds = events.map((f) => JSON.parse(readFileSync(f, 'utf8')).kind).sort(); expect(Object.keys(EVENT_MODES).sort()).toEqual(fixtureKinds);
  });
  it('each event kind has the mode the contract implies', () => {
    expect(payloadMode('message.user')).toBe('encrypted'); expect(payloadMode('agent.state')).toBe('clear'); expect(payloadMode('queue.submit')).toBe('hybrid'); expect(payloadMode('control.kick')).toBe('clear'); expect(payloadMode('nope.nope')).toBe('unknown');
  });
});
