import type { WsFactory } from '@centcom/net-relay-types';
type Fn = (...a: never[]) => void;
/** The page's own WebSocket in the shape the relay client expects. A browser cannot set headers, so the ticket travels in the hello frame, never in the address. */
export const browserWsFactory = (Ctor: typeof WebSocket = WebSocket): WsFactory => (url, protocols) => {
  const ws = new Ctor(url, protocols); const on = (ev: string, fn: Fn): void => {
    if (ev === 'open') ws.addEventListener('open', () => (fn as () => void)()); else if (ev === 'message') ws.addEventListener('message', (e) => (fn as (d: unknown, b: boolean) => void)(e.data, typeof e.data !== 'string')); else if (ev === 'close') ws.addEventListener('close', (e) => (fn as (c: number, r: unknown) => void)(e.code, e.reason)); else if (ev === 'error') ws.addEventListener('error', () => (fn as (e: Error) => void)(new Error('socket error')));
  };
  return { get readyState() { return ws.readyState; }, get protocol() { return ws.protocol; }, get bufferedAmount() { return ws.bufferedAmount; }, send: (d: string, cb: (e?: Error) => void) => { try { ws.send(d); cb(); } catch (e) { cb(e as Error); } }, close: (c?: number, r?: string) => ws.close(c, r), terminate: () => ws.close(), on } as never;
};
