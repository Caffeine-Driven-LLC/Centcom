/** The host's moves on the queue. Each is one clear frame (a reject may carry an encrypted note). */
import type { SessionHandle } from '../session/client.js';
export type RejectCode = 'not_now' | 'off_topic' | 'unsafe' | 'duplicate' | 'other'; export type DoneOutcome = 'ok' | 'error' | 'canceled';
export const hostControls = (s: Pick<SessionHandle, 'sendEvent'>) => ({
  approve: (item: string) => s.sendEvent('queue.approve', { p: { item } }),
  reject: (item: string, code: RejectCode, note?: string) => s.sendEvent('queue.reject', { p: { item, code }, secret: note ? { note } : {} }),
  reorder: (order: string[]) => s.sendEvent('queue.reorder', { p: { order } }),
  drop: (item: string) => s.sendEvent('queue.drop', { p: { item } }),
  claim: (item: string, agentId: string) => s.sendEvent('queue.claim', { p: { item, agent_id: agentId } }),
  done: (item: string, outcome: DoneOutcome) => s.sendEvent('queue.done', { p: { item, outcome } }),
});
