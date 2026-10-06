import { ProviderError, type EngineId, type NormalisedEvent } from '../types.js';

/** Checks the ordering rules of the normalised stream. Used by every adapter's tests and by dev builds; production reports the first violation as a fatal error instead of throwing. */
export class EventStreamValidator {
  private lastSeq = 0; private started = false; private inTurn = false; private fatalPending = false;
  private tools = new Set<string>(); private approvals = new Set<string>(); private open = new Set<string>(); private closed = new Set<string>();
  constructor(private engine: EngineId = 'fake') {}

  private bad(msg: string): never { throw new ProviderError('provider_protocol_error', this.engine, `Event stream: ${msg}`); }

  check(ev: NormalisedEvent): void {
    if (ev.seq !== this.lastSeq + 1) this.bad(`seq ${ev.seq} after ${this.lastSeq}`); this.lastSeq = ev.seq;
    if (this.fatalPending) { if (ev.type === 'turn.done') { if (ev.outcome !== 'error') this.bad('a fatal error must be followed by turn.done with outcome error'); } else if (ev.type !== 'status' && ev.type !== 'error' && ev.type !== 'engine.warning') this.bad(`${ev.type} after a fatal error`); }
    switch (ev.type) {
      case 'session.started': if (this.started) this.bad('second session.started'); this.started = true; break;
      case 'turn.started': if (this.inTurn) this.bad('turn.started inside a turn'); this.inTurn = true; break;
      case 'text.delta': this.needStarted(ev.type); if (this.closed.has(ev.message_id)) this.bad(`text.delta after text.done for ${ev.message_id}`); this.open.add(ev.message_id); break;
      case 'text.done': this.needStarted(ev.type); this.open.delete(ev.message_id); this.closed.add(ev.message_id); break;
      case 'tool.requested': this.needStarted(ev.type); if (this.tools.has(ev.tool_id)) this.bad(`duplicate tool.requested ${ev.tool_id}`); this.tools.add(ev.tool_id); break;
      case 'tool.result': if (!this.tools.delete(ev.tool_id)) this.bad(`tool.result without an open tool.requested (${ev.tool_id})`); break;
      case 'approval.requested': this.needStarted(ev.type); if (this.approvals.has(ev.approval_id)) this.bad('duplicate approval.requested'); this.approvals.add(ev.approval_id); break;
      case 'approval.resolved': if (!this.approvals.delete(ev.approval_id)) this.bad('approval.resolved without approval.requested'); break;
      case 'error': if (ev.fatal) this.fatalPending = true; break;
      case 'turn.done':
        if (!this.inTurn) this.bad('turn.done outside a turn (or a second turn.done)');
        if (this.tools.size) this.bad(`turn.done with ${this.tools.size} tool(s) still open`); if (this.approvals.size) this.bad('turn.done with an approval still open'); if (this.open.size) this.bad('turn.done with a message not closed by text.done');
        this.inTurn = false; this.fatalPending = false; this.open.clear(); break;
      default: break; // unknown or neutral types are tolerated (GUIDELINES 2.4)
    }
  }
  private needStarted(t: string) { if (!this.started) this.bad(`${t} before session.started`); }
  /** Call when the stream ends: anything still open is a violation. */
  end(): void { if (this.inTurn) this.bad('stream ended inside a turn'); }
}

/** Wraps a stream so each event is checked on the way through. */
export async function* validated(stream: AsyncIterable<NormalisedEvent>, engine: EngineId = 'fake'): AsyncGenerator<NormalisedEvent> {
  const v = new EventStreamValidator(engine); for await (const e of stream) { v.check(e); yield e; } v.end();
}
