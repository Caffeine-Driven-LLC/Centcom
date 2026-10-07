/** A UsageReporter wired to a scripted fetch or the mock, on a clock that fires short timers by itself. */
import { newIdGenerator } from '@centcom/protocol';
import { createHttpClient, UsageReporter, type HttpClient, type UsageReporterOptions } from '../../src/index.js';
import { AutoClock, NO_TIMEOUT, UA, scriptedFetch, type Seen } from '../http/helpers.js';
import { AGT, SES, tmp } from '../support.js';

export const ids = (clock: { now(): number }) => newIdGenerator({ now: () => clock.now(), random: (n) => crypto.getRandomValues(new Uint8Array(n)) });

let seed = 7;
export const rng = () => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed / 2 ** 31; };

type Step = Parameters<typeof scriptedFetch>[0][number];
/** Reporter over a scripted fetch. Every session counts as hosted unless `hosted` says otherwise. */
export function scriptedReporter(steps: Step[], o: Partial<UsageReporterOptions> & { clock?: AutoClock } = {}) {
  const clock = o.clock ?? new AutoClock(); const s = scriptedFetch(steps);
  const http = createHttpClient({ baseUrl: 'https://api.centcom.dev', getAccessToken: async () => 'tok-A', userAgent: UA, fetch: s.fetch, clock, rng, timeoutMs: NO_TIMEOUT });
  return { ...build(http, clock, o), seen: s.seen, posts: () => s.seen.filter((x) => x.method === 'POST') };
}
export function build(http: HttpClient, clock: AutoClock, o: Partial<UsageReporterOptions> = {}) {
  const spoolDir = o.spoolDir ?? tmp('usage');
  const r = new UsageReporter({ http, clock, ids: ids(clock), spoolDir, isLoggedIn: () => true, isHostedSession: () => true, rng, ...o });
  return { r, clock, spoolDir };
}
/** One hosted-session event; `n` makes the qty distinct. */
export const ev = (n = 1, over: Record<string, unknown> = {}) => ({ type: 'tokens_in' as const, qty: n, at: '2026-10-06T12:00:00.000Z', session_id: SES, agent_id: AGT, ...over });
export const bodyOf = (s: Seen) => JSON.parse(s.body!) as { events: { id: string; type: string; qty: number; at: string; session_id?: string; agent_id?: string }[] };
export const ok = (n = 1) => new Response(JSON.stringify({ accepted: n, duplicates: 0 }), { status: 200, headers: { 'content-type': 'application/json' } });
