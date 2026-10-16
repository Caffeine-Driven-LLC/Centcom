/** Gives the session client (C057) its connection through a transport (C074) instead of the built-in relay link. */
import type { LinkContext } from '@centcom/net';
import { openTransport, type TransportDeps } from './open.js';
import type { SessionTransport, TransportTarget } from './types.js';

export type ClientLinkDeps = Omit<TransportDeps, 'sessions' | 'getLastSeq' | 'clientInfo'>;
/**
 * `createSessionClient({ ..., linkFactory: transportLinkFactory(target, deps) })`. The relay target takes its tickets from the
 * client (join token or share-link ticket); LAN and local targets need none. `onOpen` hears each transport that was opened.
 */
export function transportLinkFactory(target: TransportTarget, deps: ClientLinkDeps, onOpen?: (t: SessionTransport) => void): (ctx: LinkContext) => SessionTransport {
  return (ctx) => {
    const t = openTransport(target.kind === 'lan' && !target.sessionId ? { ...target, sessionId: ctx.sessionId } : target, { ...deps, clientInfo: ctx.clientInfo, getLastSeq: ctx.getLastSeq, sessions: { joinToken: async () => { const k = await ctx.getTicket(); return { ticket: k.ticket, relay_url: k.url }; } } });
    onOpen?.(t); return t;
  };
}
