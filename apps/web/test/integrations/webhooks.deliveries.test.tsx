// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeliveriesTable, HealthChip } from '../../src/integrations/components.js';
import { redeliver, testWebhook, type Delivery } from '../../src/integrations/data.js';
import { HttpErr, fakeHttp } from '../workspace/helpers.js';

afterEach(cleanup);
const d = (n: number, status: string): Delivery => ({ id: `dlv_${n}`, event_type: 'session.ended', attempt: n, status, response_status: status === 'failed' ? 500 : status === 'succeeded' ? 200 : null, created_at: `2026-10-07T12:0${n}:00Z` });
describe('deliveries (acceptance 5)', () => {
  it('shows each of the 7 attempts with its state and the retry schedule', () => { render(<DeliveriesTable rows={[1, 2, 3, 4, 5, 6, 7].map((n) => d(n, n < 7 ? 'failed' : 'succeeded'))} onRedeliver={() => undefined} />); const rows = screen.getAllByRole('row'); expect(rows).toHaveLength(8); expect(within(rows[1]!).getByText('1 of 7')).toBeTruthy(); expect(within(rows[7]!).getByText('succeeded')).toBeTruthy(); expect(screen.getByText(/tried again up to 7 times/)).toBeTruthy(); });
  it('Redeliver posts with an Idempotency-Key; a refusal gives the error and no crash', async () => {
    const f = vi.fn(); render(<DeliveriesTable rows={[d(1, 'failed')]} onRedeliver={f} />); fireEvent.click(screen.getByText('Redeliver')); expect(f).toHaveBeenCalledWith(expect.objectContaining({ id: 'dlv_1' }));
    const ok = fakeHttp(() => ({})); expect(await redeliver(ok, 'whk_1', 'dlv_1', 'KEY')).toEqual({ ok: true }); expect(ok.calls[0]).toMatchObject({ op: 'redeliverWebhook', args: { id: 'whk_1', dlv: 'dlv_1' }, o: { idempotencyKey: 'KEY' } }); expect((await redeliver(fakeHttp(() => ({})), 'a', 'b')).ok).toBe(true);
    expect(await redeliver(fakeHttp(() => { throw new HttpErr('forbidden', 403); }), 'a', 'b')).toMatchObject({ ok: false, reason: 'forbidden' }); expect(await redeliver(fakeHttp(() => { throw new HttpErr('rate_limited', 429, 3); }), 'a', 'b')).toMatchObject({ ok: false, reason: 'rate_limited', retryAfterS: 3 });
  });
  it('a test delivery that does not answer in 10 s shows as timeout', async () => {
    const http = { calls: [], call: (_o: string, _a: unknown, o?: { signal?: AbortSignal }) => new Promise((_res, rej) => o?.signal?.addEventListener('abort', () => rej(new Error('aborted')))), listPage: async () => ({ data: [], has_more: false }) } as never; const r = await testWebhook(http, 'whk_1', 30); expect(r).toMatchObject({ ok: true, delivery: { status: 'timeout' } });
  });
  it('the health chip says failing or disabled in words', () => { render(<><HealthChip status="failing" enabled /><HealthChip status="healthy" enabled={false} /></>); expect(screen.getByText('failing')).toBeTruthy(); expect(screen.getByText('disabled')).toBeTruthy(); });
});
