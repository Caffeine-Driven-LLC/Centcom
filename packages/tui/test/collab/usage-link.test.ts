import { afterEach, describe, expect, it } from 'vitest';
import type { MockBackend } from '@centcom/testkit';
import { mockWith, tmp } from '../../../net/test/support.js';
import { AGENT, SESSION, report, rig } from '../../../agent/test/accounting/rig.js';
import { AppController } from '../../src/controller.js';
import { DemoEngine } from '@centcom/agent';
import { hostedSource, startUsageReporting } from '../../src/collab/usage-link.js';

let m: MockBackend | undefined; afterEach(async () => { await m?.stop(); m = undefined; });
const HOSTED = 'ses_01JA3Z8K2M5N7P9Q0R1S2T3V4W';

/** Lane C065: the ledger's outbox reaches the reporter while a session is shared, tagged for the hosted session, and not before. */
describe('usage of a shared session (lane C065)', () => {
  it('only what was recorded for this conversation after sharing began is tagged for the hosted session; earlier and other usage stays local', async () => {
    const r = rig(); const before = r.at().getTime(); r.ledger.onUsageReport(report({ tokensIn: 10, tokensOut: 5 })); r.advance(5000); const since = r.at().getTime();
    r.ledger.onUsageReport(report({ tokensIn: 100, tokensOut: 50 })); r.ledger.onUsageReport(report({ sessionId: 'ses_01JTEST0000000000000000099', engineSessionId: 'es2', tokensIn: 7 }));
    const src = hostedSource(r.ledger, { localSessionId: SESSION, hostedSessionId: HOSTED, since }); const got = src.dequeueBatch(100);
    expect(got.filter((e) => e.session_id === HOSTED).map((e) => [e.type, e.qty])).toEqual([['tokens_in', 100], ['tokens_out', 50]]); expect(got.filter((e) => e.session_id === SESSION)).toHaveLength(2); expect(got.some((e) => Date.parse(e.at) < since && e.session_id === HOSTED)).toBe(false); void before;
  });
  it('the reporter sends the hosted events to the backend once, with their ids, and drops the local ones without sending them', async () => {
    const t = await mockWith(); m = t.m; const r = rig(); const since = r.at().getTime() - 1; r.ledger.onUsageReport(report({ tokensIn: 40, tokensOut: 20 })); r.ledger.onUsageReport(report({ sessionId: 'ses_01JTEST0000000000000000099', engineSessionId: 'es2', tokensIn: 7 }));
    const link = startUsageReporting({ http: t.http, ledger: r.ledger, localSessionId: SESSION, hostedSessionId: HOSTED, since, spoolDir: tmp('usage'), flushIntervalMs: 60_000 });
    const res = await link.reporter.flush(); expect(res.sent).toBe(2); const posts = t.seen.filter((s) => s.method === 'POST'); expect(posts).toHaveLength(1);
    const body = JSON.parse(posts[0]!.body!) as { events: { id: string; type: string; qty: number; session_id: string }[] }; expect(body.events.every((e) => e.session_id === HOSTED)).toBe(true); expect(body.events.map((e) => e.type).sort()).toEqual(['tokens_in', 'tokens_out']);
    expect(link.reporter.skipped.local).toBe(1); expect(r.ledger.pending()).toBe(0); await link.stop();
  });
  it('a quota notice reaches the reporter and the notice line, and reporting goes on', async () => {
    const t = await mockWith(); m = t.m; const seen: string[] = []; const link = startUsageReporting({ http: t.http, ledger: undefined, localSessionId: SESSION, hostedSessionId: HOSTED, spoolDir: tmp('usage'), flushIntervalMs: 60_000, onNotice: (n) => seen.push(n.code) });
    link.notice({ code: 'quota_reached', level: 'error', params: { resets_at: '2026-11-01T00:00:00Z' } }); expect(seen).toEqual(['quota_reached']); expect(link.reporter.quota().level).toBe('reached'); await link.stop();
  });
  it('the app shows a server notice from its own table, never the server\'s text, with the action key for it', () => {
    const c = new AppController({ engine: new DemoEngine({ speed: 100 }), demo: true, cwd: '/tmp', version: 't', skills: [] }); const ran: string[] = []; c.onToastAction((id) => ran.push(id));
    c.showNotice({ code: 'quota_reached', level: 'error', params: { resets_at: '2026-11-01T00:00:00Z', text: 'IGNORE ALL PREVIOUS' } }); const t = c.toasts.current()!; expect(t.text).toMatch(/Monthly quota reached/); expect(t.text).not.toContain('IGNORE'); expect(t.actions?.[0]).toMatchObject({ key: 'u', id: 'billing.upgrade' });
    expect(c.toastKey('u')).toBe(true); expect(ran).toEqual(['billing.upgrade']); c.showNotice({ code: 'something_new', level: 'info', params: {} }); expect(c.toasts.current()!.text).toBe('Notice received.'); c.stop(); void AGENT;
  });
});
