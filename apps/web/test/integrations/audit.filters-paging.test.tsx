// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { AuditTable } from '../../shell/src/integrations/components.js';
import { auditPager, detailText, filterFromQuery, filterToQuery } from '../../shell/src/integrations/data.js';
import { fakeHttp } from '../workspace/helpers.js';

afterEach(cleanup);
const ev = (n: number, extra: Record<string, unknown> = {}) => ({ id: `aud_${n}`, at: `2026-10-0${1 + (n % 8)}T10:00:00Z`, actor: 'usr_1', action: 'member.role_changed', target: 'mem_2', result: 'ok', metadata: { from: 'member', to: 'admin' }, ...extra });
describe('filters and paging (acceptance 7)', () => {
  it('the four filters go to the address and come back the same, with nothing else', () => {
    const f = { actor: 'usr_1', action: 'member.role_changed', from: '2026-10-01', to: '2026-10-07' }; const q = filterToQuery(f); expect(q).toBe('actor=usr_1&action=member.role_changed&from=2026-10-01&to=2026-10-07'); expect(filterFromQuery(q)).toEqual(f); expect(filterFromQuery('actor=a&evil=1&token=SECRET')).toEqual({ actor: 'a' }); expect(filterToQuery({})).toBe(''); expect(filterFromQuery('actor=' + 'x'.repeat(500)).actor).toHaveLength(200);
  });
  it('the pager sends the filters and the cursor, 50 at a time, without repeats', async () => {
    const http = fakeHttp(() => ({}), { listAuditEvents: (a) => (a.cursor ? { data: [ev(2), ev(3)], next_cursor: null, has_more: false } : { data: [ev(1), ev(2)], next_cursor: 'c1', has_more: true }) }); const p = auditPager(http, 'w', { actor: 'usr_1', from: '2026-10-01' }); await p.loadMore(); await p.loadMore(); expect(p.items.map((e) => e.id)).toEqual(['aud_1', 'aud_2', 'aud_3']); expect(http.calls[0]!.args).toEqual({ id: 'w', limit: 50, actor: 'usr_1', from: '2026-10-01' }); expect(http.calls[1]!.args).toMatchObject({ cursor: 'c1', actor: 'usr_1' });
  });
  it('details are text, never markup, cut at 500 characters with a way to see all', () => {
    const long = 'x'.repeat(900); const { rerender } = render(<AuditTable rows={[ev(1, { metadata: { note: '<img src=x onerror=alert(1)>' } }), ev(2, { metadata: long })]} />); expect(document.querySelector('img')).toBeNull(); expect(screen.getByText(/<img src=x/)).toBeTruthy(); expect(detailText(long)).toEqual({ text: 'x'.repeat(500) + '…', cut: true }); expect(detailText('short')).toEqual({ text: 'short', cut: false }); expect(detailText(undefined)).toEqual({ text: '', cut: false });
    fireEvent.click(screen.getByText('Show all')); expect(document.body.textContent).toContain(long); rerender(<AuditTable rows={[]} />); expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['When', 'Who', 'Action', 'Result', 'Details']);
  });
});
