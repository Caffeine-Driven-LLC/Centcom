import { describe, expect, it } from 'vitest';
import { SettingsForm } from '../../shell/src/workspace/data.js';
import { HttpErr, fakeHttp } from './helpers.js';

const base = { auto_approve: 'ask', share_history: true, history_retention_days: 30 };
describe('ETag handling (acceptance 3)', () => {
  it('PATCH carries If-Match with the loaded ETag and takes the new one from the answer', async () => {
    const http = fakeHttp((c) => (c.op === 'getWorkspaceSettings' ? { data: base, etag: '"v1"', replayed: false, status: 200 } : { data: { ...base, auto_approve: 'everyone' }, etag: '"v2"', replayed: false, status: 200 })); const f = new SettingsForm(http, 'w'); await f.load(); expect(await f.save({ auto_approve: 'everyone' })).toEqual({ ok: true }); expect(http.calls[1]!.o!.ifMatch).toBe('"v1"'); expect(f.etag).toBe('"v2"'); await f.save({ share_history: false }); expect(http.calls[2]!.o!.ifMatch).toBe('"v2"');
  });
  it('a 412 says "changed elsewhere", overwrites nothing, and reapplying sends my edit over their newest values with the new ETag', async () => {
    let step = 0; const theirs = { ...base, history_retention_days: 7 }; const http = fakeHttp((c) => { if (c.op === 'getWorkspaceSettings') return { data: step === 0 ? base : theirs, etag: step === 0 ? '"v1"' : '"v9"', replayed: false, status: 200 }; if (step++ === 0) throw new HttpErr('precondition_failed', 412); return { data: { ...theirs, auto_approve: 'trusted' }, etag: '"v10"', replayed: false, status: 200 }; });
    const f = new SettingsForm(http, 'w'); await f.load(); const r = await f.save({ auto_approve: 'trusted' }); expect(r).toEqual({ ok: false, reason: 'changed_elsewhere' }); expect(f.conflict).toMatchObject({ theirs, mine: { auto_approve: 'trusted' } }); expect(f.value).toEqual(base); expect(f.etag).toBe('"v9"');
    expect(await f.reapply()).toEqual({ ok: true }); const last = http.calls.at(-1)!; expect(last.o!.ifMatch).toBe('"v9"'); expect(last.args.body).toEqual({ auto_approve: 'trusted' }); expect(f.value).toMatchObject({ history_retention_days: 7, auto_approve: 'trusted' }); expect(f.conflict).toBeUndefined();
  });
  it('403, 429 and 404 are told apart', async () => { for (const [code, status, reason] of [['forbidden', 403, 'forbidden'], ['rate_limited', 429, 'rate_limited'], ['not_found', 404, 'gone']] as const) { const http = fakeHttp(() => { throw new HttpErr(code, status, 7); }); const f = new SettingsForm(http, 'w'); const r = await f.save({ share_history: true }); expect(r).toMatchObject({ ok: false, reason }); if (reason === 'rate_limited') expect(r).toMatchObject({ retryAfterS: 7 }); } });
});
