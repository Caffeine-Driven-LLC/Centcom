/** Frame ids (CT-IDS, CT-WS-ENVELOPE): `msg_` + a monotonic ULID, so ids from one client strictly increase even within one millisecond.
 *  Must not: reuse an id for a different frame, or read the wall clock when a clock is injected. */
import { newIdGenerator, type Id, type IdPrefix } from '@centcom/protocol';

export const MSG_ID_RE = /^msg_[0-9A-HJKMNP-TV-Z]{26}$/;
export const isMsgId = (s: unknown): s is Id<'msg'> => typeof s === 'string' && MSG_ID_RE.test(s);

/** The id source the channel takes (the C003 generator fits). */
export interface IdGenerator { next<P extends IdPrefix>(prefix: P): Id<P> }

/** A monotonic generator on the injected clock, with CSPRNG randomness unless a test passes its own. */
export function createMsgIdGenerator(o: { now: () => number; random?: (n: number) => Uint8Array }): IdGenerator {
  return newIdGenerator({ now: o.now, random: o.random ?? ((n) => crypto.getRandomValues(new Uint8Array(n))) });
}
