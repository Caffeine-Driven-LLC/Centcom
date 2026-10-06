import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AGENT_WIRE_STATES, ProtocolError, STATE_NAMES, assertWritableFrame, isAgentWireState, parseEventPayload, parseFrame, parseSecretPayload } from '../src/index.js';

const FIX = join(__dirname, '../../../contracts/fixtures');
const ev = (k: string) => JSON.parse(readFileSync(join(FIX, 'events', `${k}.json`), 'utf8')).frame;

describe('reading is tolerant (CT-VER "Unknown data")', () => {
  it('accepts an extra top-level field and flags an unknown event kind', () => {
    const f = { ...ev('agent.state'), shiny_new_field: 1, k: 'agent.teleport' };
    const r = parseFrame(f); expect(r).toMatchObject({ ok: true, unknown: true });
  });
  it('accepts a frame with an unknown type', () => { expect(parseFrame({ v: 1, t: 'sys.brand_new' })).toMatchObject({ ok: true }); });
  it('accepts an unknown enum value inside a payload, unchanged', () => {
    const p = { agent_id: 'agt_01JA3Z8K2M5N7P9Q0R1S2T3V4W', state: 'not-a-state', since: '2026-10-05T18:07:41.123Z' };
    const r = parseEventPayload('agent.state', p); expect(r).toMatchObject({ ok: true, value: p }); expect(isAgentWireState('not-a-state')).toBe(false);
  });
  it('lets unknown event kinds through untouched, both clear and secret', () => { expect(parseEventPayload('x.y', { a: 1 })).toEqual({ ok: true, value: { a: 1 }, unknown: true }); expect(parseSecretPayload('x.y', 5)).toMatchObject({ ok: true, unknown: true }); });
  it('still rejects what is really broken, with a pointer and a code', () => {
    const r = parseFrame({ v: 2, t: 'event' }); expect(r.ok).toBe(false); if (!r.ok) expect(r.issues.length).toBeGreaterThan(0);
    expect(parseFrame('not an object').ok).toBe(false); expect(parseFrame(null).ok).toBe(false);
    const bad = parseEventPayload('agent.state', { state: 5 }); expect(bad.ok).toBe(false);
  });
  it('says clearly when a kind has no cleartext or no secret part', () => {
    expect(parseEventPayload('message.user', {})).toMatchObject({ ok: false, issues: [{ code: 'no_clear_payload' }] }); expect(parseSecretPayload('agent.state', {})).toMatchObject({ ok: false, issues: [{ code: 'no_secret_payload' }] });
  });
});

describe('writing is exact', () => {
  it('rejects the same frame the reader accepts', () => {
    const f = { ...ev('agent.state'), shiny_new_field: 1, k: 'agent.teleport' };
    expect(() => assertWritableFrame(f)).toThrow(ProtocolError);
    expect(() => assertWritableFrame({ ...ev('agent.state'), extra: 1 })).toThrow(/unknown_field/); expect(() => assertWritableFrame({ ...ev('agent.state'), k: 'agent.teleport' })).toThrow(/unknown_kind/);
  });
  it('rejects a payload with a value the contract does not define', () => {
    expect(parseFrame({ ...ev('agent.state'), t: 'event' }).ok).toBe(true); expect(() => assertWritableFrame({ v: 1, t: 'nope' })).toThrow(ProtocolError);
  });
});

describe('state names come from the contract, not a hand-kept list', () => {
  const sm = JSON.parse(readFileSync(join(__dirname, '../../../contracts/state-map.json'), 'utf8'));
  it('STATE_NAMES equals the keys of state-map.json', () => { expect([...STATE_NAMES]).toEqual(Object.keys(sm).sort()); });
  it('AGENT_WIRE_STATES is a subset and leaves out connectivity, account, limit and social states', () => {
    for (const s of AGENT_WIRE_STATES) expect(Object.keys(sm)).toContain(s);
    for (const bad of ['offline', 'reconnecting', 'high-five', 'first-run', 'celebrate', 'listening', 'prompt-received', 'host-session']) expect(AGENT_WIRE_STATES, bad).not.toContain(bad as never);
    for (const s of AGENT_WIRE_STATES) expect(s.startsWith('provider-') || s.startsWith('ci-') || s.startsWith('pr-'), s).toBe(false);
    for (const good of ['awaiting-approval', 'editing-file', 'idle', 'merge-conflict', 'deploying', 'saving']) expect(AGENT_WIRE_STATES).toContain(good as never);
    expect(AGENT_WIRE_STATES.length).toBeLessThan(STATE_NAMES.length);
  });
});
