/** Cursor pagination (CT-PAGE): `?limit=<1..200, default 50>&cursor=<opaque>` in, `{ data, next_cursor, has_more }` out.
 *  Must not: use offsets or `fields=`, change a cursor, or fetch a page the caller has not asked for (no prefetch). */
import type { PaginatedOperationId } from './generated/operations.js';
import type { HttpResult, OperationArgs, Page, PageItem } from './types.js';

export const DEFAULT_PAGE_LIMIT = 50; export const MAX_PAGE_LIMIT = 200;

/** A limit outside 1..200 is a caller bug: refused locally, never sent. */
export function checkPageLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_LIMIT) throw new RangeError(`page limit must be an integer from 1 to ${MAX_PAGE_LIMIT}`);
  return limit;
}

type Caller = <K extends PaginatedOperationId>(op: K, args: OperationArgs<K>, o: { signal?: AbortSignal }) => Promise<HttpResult<unknown>>;

/** Reads `{ data, next_cursor, has_more }`. The body was already checked against the contract, so only the page fields are looked at here. */
function toPage<T>(body: unknown): Page<T> {
  const b = (body ?? {}) as { data?: unknown; next_cursor?: unknown; has_more?: unknown };
  const data = Array.isArray(b.data) ? (b.data as T[]) : [];
  const nextCursor = typeof b.next_cursor === 'string' && b.next_cursor !== '' ? b.next_cursor : null;
  return { data, nextCursor, hasMore: b.has_more === true && nextCursor !== null };
}

export async function listPage<K extends PaginatedOperationId>(call: Caller, op: K, args: OperationArgs<K> & { cursor?: string; limit?: number }, o: { signal?: AbortSignal } = {}): Promise<Page<PageItem<K>>> {
  const { cursor, limit, ...rest } = args as OperationArgs<K> & { cursor?: string; limit?: number; query?: Record<string, unknown> };
  const q = { ...(rest.query ?? {}) };
  const lim = checkPageLimit(limit ?? (typeof q.limit === 'number' ? q.limit : DEFAULT_PAGE_LIMIT));
  const cur = cursor ?? (typeof q.cursor === 'string' ? q.cursor : undefined);
  if (cur !== undefined && (typeof cur !== 'string' || cur === '')) throw new TypeError('cursor must be a non-empty string from next_cursor');
  const query = { ...q, limit: lim, ...(cur !== undefined ? { cursor: cur } : {}) };
  if (cur === undefined) delete (query as { cursor?: unknown }).cursor;
  const r = await call(op, { ...rest, query } as unknown as OperationArgs<K>, o);
  return toPage<PageItem<K>>(r.data);
}

/** Yields every item in order. A failing page (for example `cursor_invalid` after 24 h) ends the iteration with that error; start again from the first page. */
export function paginate<K extends PaginatedOperationId>(call: Caller, op: K, args: OperationArgs<K>, o: { limit?: number; signal?: AbortSignal } = {}): AsyncIterable<PageItem<K>> {
  const limit = checkPageLimit(o.limit ?? DEFAULT_PAGE_LIMIT);
  const base = { ...(args as { query?: Record<string, unknown> }) }; const q = { ...(base.query ?? {}) }; delete q.cursor; delete q.limit;
  return {
    async *[Symbol.asyncIterator]() {
      let cursor: string | undefined;
      for (;;) {
        const page = await listPage(call, op, { ...base, query: q, limit, ...(cursor !== undefined ? { cursor } : {}) } as unknown as OperationArgs<K> & { cursor?: string; limit?: number }, { signal: o.signal });
        for (const item of page.data) yield item;
        if (!page.hasMore || page.nextCursor === null || page.nextCursor === cursor) return;
        cursor = page.nextCursor;
      }
    },
  };
}
