import { describe, expect, it } from 'vitest';
import { PAGE_LIMIT, membersPager } from '../../shell/src/workspace/data.js';
import { fakeHttp } from './helpers.js';

const people = (from: number, n: number) => Array.from({ length: n }, (_, i) => ({ id: `mem_${from + i}`, role: 'member' }));
describe('member paging (acceptance 2)', () => {
  it('asks for 50 at a time with the cursor, shows each person once, and stops when has_more is false', async () => {
    const http = fakeHttp(() => ({}), { listMembers: (a) => (a.cursor === undefined ? { data: people(0, 50), next_cursor: 'c1', has_more: true } : a.cursor === 'c1' ? { data: [...people(40, 10), ...people(50, 40)], next_cursor: 'c2', has_more: true } : { data: people(90, 5), next_cursor: null, has_more: false }) });
    const p = membersPager(http, 'wsp_1'); await p.loadMore(); expect(p.items).toHaveLength(50); expect(p.hasMore).toBe(true); await p.loadMore(); expect(p.items).toHaveLength(90); expect(new Set(p.items.map((m) => m.id)).size).toBe(90); await p.loadMore(); expect(p.items).toHaveLength(95); expect(p.hasMore).toBe(false); await p.loadMore(); expect(http.calls.filter((c) => c.op === 'listMembers')).toHaveLength(3);
    expect(http.calls[0]!.args).toEqual({ id: 'wsp_1', limit: PAGE_LIMIT }); expect(http.calls[1]!.args).toMatchObject({ cursor: 'c1' });
  });
  it('a second press while loading adds nothing; a failure keeps what is there and lets you retry', async () => {
    let fail = true; const http = fakeHttp(() => ({}), { listMembers: () => { if (fail) throw new Error('down'); return { data: people(0, 3), next_cursor: null, has_more: false }; } }); const p = membersPager(http, 'w'); await p.loadMore(); expect(p.error).toBeTruthy(); expect(p.items).toEqual([]); expect(p.hasMore).toBe(true); fail = false; await Promise.all([p.loadMore(), p.loadMore()]); expect(p.items).toHaveLength(3); expect(http.calls.filter((c) => c.op === 'listMembers')).toHaveLength(2);
  });
});
