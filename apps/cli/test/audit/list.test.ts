import { describe, expect, it } from 'vitest';
import { parseTimeFilter, runAudit } from '../../src/commands/audit/index.js';
import { WS, ev, json, page, problem, rig } from './helpers.js';

describe('audit list', () => {
  it('--limit 120 follows cursors until 120 rows, asks for at most 200 per page and never an offset; --json is one array of 120', async () => {
    const pages = [page(Array.from({ length: 50 }, (_, i) => ev(i)), 'c1'), page(Array.from({ length: 50 }, (_, i) => ev(i + 50)), 'c2'), page(Array.from({ length: 50 }, (_, i) => ev(i + 100)), 'c3')];
    const r = rig(pages.map((p) => () => p)); expect(await runAudit(['list', '--limit', '120', '--json'], r.deps)).toBe(0); const arr = JSON.parse(r.out[0]!); expect(Array.isArray(arr)).toBe(true); expect(arr).toHaveLength(120);
    expect(r.calls()).toHaveLength(3); for (const c of r.calls()) { expect(Number(c.url.searchParams.get('limit'))).toBeLessThanOrEqual(200); expect(c.url.searchParams.has('offset')).toBe(false); } expect(r.calls()[1]!.url.searchParams.get('cursor')).toBe('c1'); expect(r.calls()[0]!.url.pathname).toBe(`/v1/workspaces/${WS}/audit`);
  });
  it('filters go out as query parameters; a relative --from is resolved on the injected clock to a UTC time with milliseconds', async () => {
    const r = rig([() => page([ev(1)])]); expect(await runAudit(['list', '--actor', 'usr_1', '--action', 'member.removed', '--from', '24h', '--to', '2026-10-07T11:00:00Z'], r.deps)).toBe(0); const q = r.calls()[0]!.url.searchParams;
    expect(q.get('actor')).toBe('usr_1'); expect(q.get('action')).toBe('member.removed'); expect(q.get('from')).toBe('2026-10-06T12:00:00.000Z'); expect(q.get('to')).toBe('2026-10-07T11:00:00.000Z'); expect(q.get('from')).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
  });
  it('bad times, a reversed range, a bad limit and unknown options are refused locally with exit 1', async () => {
    for (const a of [['--from', 'yesterday'], ['--to', '2026-13-01T00:00:00Z'], ['--from', '2026-02-31T00:00:00Z'], ['--from', '1h', '--to', '5h'], ['--limit', '0'], ['--limit', 'x'], ['--limit', '1001'], ['--nope'], ['--actor'], ['--workspace', 'bad']]) { const r = rig([() => page([])]); expect(await runAudit(['list', ...a], r.deps), a.join(' ')).toBe(1); expect(r.calls()).toHaveLength(0); expect(r.err.length).toBeGreaterThan(0); }
  });
  it('time parsing: RFC 3339 with offsets, fractions and relative units', () => {
    const now = new Date(Date.UTC(2026, 9, 7, 12)); expect(parseTimeFilter('2026-10-01T02:00:00+02:00', now)).toBe('2026-10-01T00:00:00.000Z'); expect(parseTimeFilter('2026-10-01T00:00:00.123456Z', now)).toBe('2026-10-01T00:00:00.123Z'); expect(parseTimeFilter('90m', now)).toBe('2026-10-07T10:30:00.000Z'); expect(parseTimeFilter('7d', now)).toBe('2026-09-30T12:00:00.000Z'); expect(parseTimeFilter('2w', now)).toBe('2026-09-23T12:00:00.000Z'); expect(parseTimeFilter('30s', now)).toBe('2026-10-07T11:59:30.000Z');
    for (const bad of ['', 'now', '24', 'h', '2026-10-01', '1.5h', '-1h', '2026-10-01 00:00:00', 'x'.repeat(100)]) expect(() => parseTimeFilter(bad, now), bad).toThrow();
  });
  it('the table strips control characters and escape sequences; --json keeps the data as received; exit 4 and a message when nothing matches', async () => {
    const dirty = ev(1, { action: 'x\u001b[31mred\u001b[0m\u0007y', actor: { type: 'user', id: 'a\nb\u001b]0;title\u0007c' }, target: { type: 'doc', id: '\u0000z' } }); const t = rig([() => page([dirty])]); await runAudit(['list'], t.deps); const all = t.out.join('\n'); expect(all).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f]/); expect(all).toContain('xred y'); expect(all).toMatch(/TIME\s+ACTOR\s+ACTION\s+TARGET\s+OUTCOME/);
    const j = rig([() => page([dirty])]); await runAudit(['list', '--json'], j.deps); expect(JSON.parse(j.out[0]!)[0].action).toBe(dirty.action);
    const none = rig([() => page([])]); expect(await runAudit(['list'], none.deps)).toBe(4); expect(none.out[0]).toContain('No audit events'); const nj = rig([() => page([])]); expect(await runAudit(['list', '--json'], nj.deps)).toBe(4); expect(JSON.parse(nj.out[0]!)).toEqual([]);
  });
  it('a plan without the audit log makes no audit request; 403 gives the admin hint; a signed-out user gets exit 2; no token appears anywhere', async () => {
    const off = rig([() => page([])], { entitlementDays: 0 }); expect(await runAudit(['list'], off.deps)).toBe(1); expect(off.err[0]).toContain('not part of your plan'); expect(off.calls()).toHaveLength(0);
    const f = rig([() => problem('forbidden', 403)]); expect(await runAudit(['list'], f.deps)).toBe(1); expect(f.err[0]).toContain('admin or owner'); expect(f.err.join()).not.toMatch(/at |Error:/);
    const a = rig([() => problem('token_invalid', 401)]); expect(await runAudit(['list'], a.deps)).toBe(2); expect(a.err[0]).toContain('centcom login'); for (const x of [off, f, a]) expect(x.out.join() + x.err.join()).not.toContain('BEARER-TOKEN');
    const e = rig([() => json({ weird: true })]); expect(await runAudit(['list'], e.deps)).toBe(1);
  });
  it('help and unknown subcommands', async () => { const r = rig([() => page([])]); expect(await runAudit(['help'], r.deps)).toBe(0); expect(r.err[0]).toContain('Usage: centcom audit'); expect(await runAudit(['wat'], rig([() => page([])]).deps)).toBe(1); });
});
