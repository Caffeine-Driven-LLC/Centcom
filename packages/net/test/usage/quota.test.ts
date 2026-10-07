import { describe, expect, it } from 'vitest';
import { QuotaTracker, type QuotaState } from '../../src/index.js';
import { AutoClock } from '../http/helpers.js';
import { scriptedReporter, ok, ev } from './helpers.js';

const at = (clock: AutoClock, s: number) => new Date(clock.t + s * 1000).toISOString();
describe('quota state from notices', () => {
  it('usage_warning is a warning with its percent; quota_reached is reached and stays until resets_at, then it is ok again', () => {
    const c = new AutoClock(0); const q = new QuotaTracker(c); const seen: QuotaState[] = []; q.onQuota((s) => seen.push(s));
    q.handleNotice({ code: 'usage_warning', level: 'warn', params: { pct: 80, resets_at: at(c, 3600) } }); expect(q.quota()).toMatchObject({ level: 'warning', pct: 80 }); expect(q.allowsHostedActions()).toBe(true);
    q.handleNotice({ code: 'quota_reached', level: 'error', params: { resets_at: at(c, 3600) } }); expect(q.quota()).toMatchObject({ level: 'reached', pct: 100 }); expect(q.allowsHostedActions()).toBe(false);
    q.handleNotice({ code: 'usage_warning', params: { pct: 85 } }); expect(q.quota().level).toBe('reached'); /* a warning never lowers a reached quota */
    c.t += 3599_000; expect(q.quota().level).toBe('reached'); c.t += 2000; expect(q.quota()).toEqual({ level: 'ok' }); expect(q.allowsHostedActions()).toBe(true); expect(seen.map((s) => s.level)).toEqual(['warning', 'reached', 'ok']); q.dispose();
  });
  it('unknown codes and odd params are ignored; a percent outside 0 to 100 is dropped', () => { const q = new QuotaTracker(new AutoClock(0)); q.handleNotice({ code: 'plan_changed' }); q.handleNotice(undefined as never); expect(q.quota()).toEqual({ level: 'ok' }); q.handleNotice({ code: 'usage_warning', params: { pct: 400, resets_at: 'not a date' } }); expect(q.quota()).toEqual({ level: 'warning' }); q.dispose(); });
  it('neither a warning nor a reached quota stops flush() or record()', async () => {
    const r = scriptedReporter([() => ok(2)]); r.r.start(); r.r.handleNotice({ code: 'quota_reached', params: { resets_at: at(r.clock, 600) } }); r.r.record(ev(1)); r.r.record(ev(2)); const f = await r.r.flush(); expect(f.sent).toBe(2); expect(r.r.quota().level).toBe('reached'); await r.r.stop();
  });
});
