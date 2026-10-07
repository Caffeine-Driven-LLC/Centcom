/** Checks that mirror the server's rules, for a faster and clearer answer. The server decides; these only save a round trip. */
import { NotAllowedError, QueueFullError } from './errors.js';
export const MEMBER_CAP = 5; export const DEFAULT_QUEUE_LIMIT = 20;
export interface SubmitFacts { role: 'host' | 'editor' | 'viewer'; muted: boolean; locked: boolean; paused: boolean; liveOfMember: number; liveTotal: number; queueLimit?: number }
export function checkSubmit(f: SubmitFacts): void {
  if (f.role === 'viewer') throw new NotAllowedError('viewer'); if (f.muted) throw new NotAllowedError('muted'); if (f.locked && f.role !== 'host') throw new NotAllowedError('locked');
  if (f.liveOfMember >= MEMBER_CAP) throw new QueueFullError('member'); if (f.liveTotal >= (f.queueLimit ?? DEFAULT_QUEUE_LIMIT)) throw new QueueFullError('session');
}
