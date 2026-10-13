/**
 * Usage reporting for a shared session (lane C065): while a hosted session is live, what the ledger recorded for this conversation is
 * reported to the server (informational only: nothing here decides what anyone may do), and the server's notices (usage near the
 * quota, quota reached, plan changed) reach the notice line. Local and LAN use never reaches the reporter.
 */
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { defaultDeps, stateDir } from '@centcom/config';
import { UsageReporter, type SessionNotice, type UsageEventInput, type UsageSource, type HttpClient } from '@centcom/net';
import { newIdGenerator } from '@centcom/protocol';
import type { Ledger } from '@centcom/agent';

export interface UsageLinkOptions {
  http: HttpClient; ledger: Ledger | undefined;
  /** the conversation's own session id (what the ledger tags its events with) and the hosted session's id (what the server knows) */
  localSessionId: string; hostedSessionId: string;
  /** only events from this moment on belong to the hosted session */ since?: number;
  spoolDir?: string; flushIntervalMs?: number;
  /** quota changes and server notices, in the app's words */ onNotice?: (n: SessionNotice) => void;
}
export interface UsageLink { reporter: UsageReporter; notice(n: SessionNotice): void; stop(): Promise<void> }

/** The ledger's outbox with its events tagged for the hosted session, and only those made while sharing; older ones are acknowledged and left out (local use is never reported). */
export function hostedSource(ledger: Ledger, o: { localSessionId: string; hostedSessionId: string; since: number }): UsageSource {
  return {
    dequeueBatch: (max) => ledger.dequeueBatch(max).map((e): UsageEventInput => (e.session_id === o.localSessionId && Date.parse(e.at) >= o.since ? { ...e, session_id: o.hostedSessionId } : e)),
    ack: (ids) => ledger.ack(ids), requeue: (ids) => ledger.requeue(ids),
  };
}

export function startUsageReporting(o: UsageLinkOptions): UsageLink {
  const clock = { now: () => Date.now(), setTimeout: (f: () => void, ms: number) => { const h = setTimeout(f, ms); h.unref?.(); return h; }, clearTimeout: (h: never) => clearTimeout(h as unknown as NodeJS.Timeout) };
  const ids = newIdGenerator({ now: () => Date.now(), random: (n) => new Uint8Array(randomBytes(n)) });
  const since = o.since ?? Date.now();
  const reporter = new UsageReporter({
    http: o.http, spoolDir: o.spoolDir ?? join(stateDir(defaultDeps()), 'usage'), clock, ids, isLoggedIn: () => true, isHostedSession: (id) => id === o.hostedSessionId, flushIntervalMs: o.flushIntervalMs,
    ...(o.ledger ? { source: hostedSource(o.ledger, { localSessionId: o.localSessionId, hostedSessionId: o.hostedSessionId, since }) } : {}),
  });
  reporter.start();
  return { reporter, notice: (n) => { reporter.handleNotice(n); o.onNotice?.(n); }, stop: () => reporter.stop() };
}
