import { describe, expect, it } from 'vitest';
import { runExport } from '../../shell/src/integrations/data.js';
import { fakeHttp } from '../workspace/helpers.js';

function world(script: (n: number) => { status: string; download_url?: string }) { let polls = 0; let t = 0; const http = fakeHttp((c) => (c.op === 'createAuditExport' ? { id: 'exp_1', status: 'pending', format: 'csv', created_at: 'x' } : { id: 'exp_1', format: 'csv', created_at: 'x', ...script(++polls) })); return { http, polls: () => polls, o: { now: () => t, sleep: async (ms: number) => { t += ms; } } }; }
describe('export polling (acceptance 6)', () => {
  it('creates the export with an Idempotency-Key and polls every 3 s until a download link appears', async () => { const w = world((n) => (n < 4 ? { status: 'pending' } : { status: 'ready', download_url: 'https://dl.centcom.dev/x' })); const r = await runExport(w.http, 'w', { format: 'csv', actor: 'a' }, w.o); expect(r).toEqual({ state: 'ready', url: 'https://dl.centcom.dev/x' }); expect(w.polls()).toBe(4); expect(w.http.calls[0]!.o!.idempotencyKey).toMatch(/^[0-9A-Z]{26}$/); expect(w.http.calls[0]!.args.body).toEqual({ format: 'csv', actor: 'a' }); expect(w.o.now()).toBe(9000); });
  it('gives up after 2 minutes with a timeout', async () => { const w = world(() => ({ status: 'pending' })); expect(await runExport(w.http, 'w', { format: 'csv' }, w.o)).toEqual({ state: 'timeout' }); expect(w.o.now()).toBe(120_000); expect(w.polls()).toBe(41); });
  it('a failed or expired job stops the polling at once', async () => { for (const status of ['failed', 'expired']) { const w = world(() => ({ status })); expect(await runExport(w.http, 'w', { format: 'csv' }, w.o)).toEqual({ state: 'failed' }); expect(w.polls()).toBe(1); } });
});
