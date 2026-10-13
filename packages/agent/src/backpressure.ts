/** What an engine does when its consumer is slow (lane C101): the event queue holds at most `EVENT_QUEUE_MAX` events; past that, streamed text is merged, chatter is dropped, and everything that matters is kept. */
import { AsyncQueue, type PushResult } from './queue.js';
import type { NormalisedEvent } from './types.js';

export const EVENT_QUEUE_MAX = 5000;
/** Text that continues the text just before it is joined to it (the sequence number is not used up). Only the same message, the same kind. */
export function mergeDelta(last: NormalisedEvent, next: NormalisedEvent): boolean {
  if (last.type === 'text.delta' && next.type === 'text.delta' && last.message_id === next.message_id && last.turn_id === next.turn_id) { last.text += next.text; return true; }
  if (last.type === 'thinking.delta' && next.type === 'thinking.delta' && last.message_id === next.message_id && last.turn_id === next.turn_id) { last.text += next.text; return true; }
  if (last.type === 'subagent.text' && next.type === 'subagent.text' && last.subagent_id === next.subagent_id) { last.text += next.text; return true; }
  return false;
}
/** Events whose loss costs nothing: progress chatter and reports that the next one replaces. Never text, tools, approvals, questions, errors or the end of a turn. */
export function droppable(ev: NormalisedEvent): boolean { return ev.type === 'status' || ev.type === 'limits.report' || ev.type === 'thinking.delta' || ev.type === 'subagent.text'; }
export const eventQueue = (max = EVENT_QUEUE_MAX): AsyncQueue<NormalisedEvent> => new AsyncQueue<NormalisedEvent>({ max, merge: mergeDelta, droppable });

/** One place that stamps and pushes an event for an engine: when the queue merged or dropped it, the sequence number is given back (the stream has no gaps), and the first drop of a streak is announced once. */
export class EventSink {
  private warned = false;
  constructor(private q: AsyncQueue<NormalisedEvent>, private max = EVENT_QUEUE_MAX) {}
  /** `stamp` builds the event with the next number; `unstamp` takes the number back. Returns what happened. */
  push(stamp: () => NormalisedEvent, unstamp: () => void, announce: (text: string) => void): PushResult {
    const r = this.q.push(stamp());
    if (r !== 'queued') unstamp();
    if (r === 'dropped' && !this.warned) { this.warned = true; announce('The screen could not keep up, so some progress updates were skipped. Nothing you asked for was lost.'); }
    else if (r === 'queued' && this.warned && this.q.size < this.max / 2) this.warned = false;
    return r;
  }
}
