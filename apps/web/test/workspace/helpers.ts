import type { Http } from '../../shell/src/workspace/data.js';
export class HttpErr extends Error { constructor(readonly code: string, readonly status: number, readonly retryAfterS?: number) { super(code); } }
export interface Call { op: string; args: Record<string, unknown>; o?: { idempotencyKey?: string; ifMatch?: string } }
export function fakeHttp(handler: (c: Call) => unknown | Promise<unknown>, pages: Record<string, (args: Record<string, unknown>) => { data: unknown[]; next_cursor?: string | null; has_more: boolean }> = {}): Http & { calls: Call[] } {
  const calls: Call[] = []; return { calls, call: async (op, args, o) => { const c = { op, args, o }; calls.push(c); const r = await handler(c); return (r && typeof r === 'object' && 'data' in (r as object) ? r : { data: r, replayed: false, status: 200 }) as never; }, listPage: async (op, args) => { calls.push({ op, args }); return (pages[op]?.(args) ?? { data: [], has_more: false }) as never; } };
}
