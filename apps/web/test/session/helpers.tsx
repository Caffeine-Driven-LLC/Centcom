import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { render } from '@testing-library/react';
import React from 'react';
import { buildRouter } from '../../src/app/router.js';
import { reset, setState } from '../../src/auth/store.js';
import { initialGuestState, reduceGuestState, SERVER, type DecodedFrame, type GuestState } from '@centcom/guest';
import { HttpProvider } from '../../src/lib/http-context.js';
import { routeModule } from '../../src/session/routes.js';
import { setSessionLoader } from '../../src/session/lazy.js';
import type { SessionConnection } from '../../src/session/engine.js';
import { ToastProvider } from '../../src/ui/index.js';
import { fakeHttp } from '../workspace/helpers.js';

export const ME = 'mem_me'; export const HOST = 'mem_host'; export const SES = 'ses_01JA3Z8K2M5N7P9Q0R1S2T3V4W';
let seq = 0; export const fr = (k: string, from: string, p?: Record<string, unknown>, secret?: Record<string, unknown>): DecodedFrame => ({ v: 1, t: 'event', id: `msg_${String(++seq).padStart(26, 'A')}`.slice(0, 30), sid: SES, from, ts: '2026-10-07T12:00:00.000Z', k, seq, ...(p ? { p } : {}), ...(secret ? { secret } : {}) }) as DecodedFrame;
export const roster = (me: 'host' | 'editor' | 'viewer'): DecodedFrame => fr('control.roster', SERVER, { version: 1, members: [{ id: HOST, name: 'Hana', slot: 0, role: me === 'host' ? 'editor' : 'host' }, { id: ME, name: 'Me', slot: 1, role: me === 'host' ? 'host' : me }] });
export function fold(frames: DecodedFrame[], me: 'host' | 'editor' | 'viewer' = 'editor'): GuestState { let s = initialGuestState({ member: ME, slot: 1, role: me }); s = reduceGuestState(s, roster(me)); for (const f of frames) s = reduceGuestState(s, f); return s; }
/** A connection that serves a state and records what the page sends. */
export function fakeConn(initial: GuestState) { const sent: { kind: string; body: unknown }[] = []; let st = initial; const subs = new Set<(s: GuestState) => void>(); const conn = { handle: { sendEvent: async (kind: string, body: unknown) => { sent.push({ kind, body }); return { id: 'x', seq: 1 }; } }, state: () => st, subscribe: (f: (s: GuestState) => void) => { subs.add(f); f(st); return () => { subs.delete(f); }; }, close: () => undefined } as unknown as SessionConnection; return { conn, sent, push: (s: GuestState) => { st = s; for (const f of [...subs]) f(s); } }; }
export function openPage(conn: SessionConnection | Promise<SessionConnection>, path = `/s/${SES}`) {
  window.scrollTo = () => undefined; reset(); setState({ status: 'authenticated' }, true); const connects: unknown[] = []; setSessionLoader(async () => ({ connectSession: async (o: unknown) => { connects.push(o); return conn; } }) as never);
  const { router } = buildRouter({ './session/routes.tsx': { routeModule } }, createMemoryHistory({ initialEntries: [path] })); render(<ToastProvider><HttpProvider http={fakeHttp(() => ({}))}><RouterProvider router={router} /></HttpProvider></ToastProvider>); return { connects, router };
}
