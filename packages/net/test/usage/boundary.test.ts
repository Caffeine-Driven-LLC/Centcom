import { describe, expect, it } from 'vitest';
import { USAGE_ID_RE } from '../../src/index.js';
import { bodyOf, ev, ok, scriptedReporter } from './helpers.js';
import { SES } from '../support.js';

describe('what may reach the network', () => {
  it('events without a hosted session (LAN, local, no session id, a bad id) are never spooled or sent', async () => {
    const r = scriptedReporter([() => ok(1)], { isHostedSession: (sid) => sid === SES }); r.r.start();
    r.r.record(ev(1, { session_id: undefined })); r.r.record(ev(2, { session_id: 'ses_01JA3Z8K2M5N7P9Q0R1S2T3V4X' })); r.r.record(ev(3, { session_id: 'lan-session' })); r.r.record(ev(4)); const f = await r.r.flush();
    expect(f.sent).toBe(1); expect(r.posts()).toHaveLength(1); expect(bodyOf(r.posts()[0]!).events.map((e) => e.qty)).toEqual([4]); expect(r.r.skipped.local).toBe(3); await r.r.stop();
  });
  it('logged out: events are discarded with one warning in total, and nothing is sent', async () => {
    const logs: string[] = []; const logger = { child: () => logger, warn: (m: string) => logs.push(m), info: () => undefined, debug: () => undefined, trace: () => undefined, error: () => undefined, flush: async () => undefined };
    const r = scriptedReporter([], { isLoggedIn: () => false, logger: logger as never }); r.r.start(); for (let i = 0; i < 5; i++) r.r.record(ev(i + 1)); await r.r.flush(); expect(r.posts()).toEqual([]); expect(logs.filter((m) => m === 'usage.logged_out_discarding')).toHaveLength(1); expect(r.r.skipped.loggedOut).toBe(5); await r.r.stop();
  });
  it('bad events (negative or fractional quantity, unknown type) are refused; every kept id is use_<ULID>; presence is not a usage event', async () => {
    const r = scriptedReporter([() => ok(1)]); r.r.start(); r.r.record(ev(-1)); r.r.record(ev(1.5)); r.r.record({ ...ev(1), type: 'queue_secrets' as never }); r.r.record(ev(7)); r.r.record(ev(8, { id: 'use_nonsense' })); await r.r.flush();
    const ids = r.posts().flatMap((p) => bodyOf(p).events.map((e) => e.id)); expect(ids.length).toBe(2); for (const id of ids) expect(id).toMatch(USAGE_ID_RE); expect(r.r.skipped.invalid).toBe(3); await r.r.stop();
  });
  it('record() never throws, even for garbage', () => { const r = scriptedReporter([]); r.r.start(); for (const x of [undefined, null, 5, 'x', {}, { session_id: {} }]) expect(() => r.r.record(x as never)).not.toThrow(); });
});
