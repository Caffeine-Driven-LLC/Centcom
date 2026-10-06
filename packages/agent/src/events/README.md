# Internal event bus

A small typed in-process bus that lets the runner, state machine, permissions, locks and the session layer talk without knowing each other. Import from `@centcom/agent` (or `@centcom/agent/events`).

```ts
import { createAgentBus } from '@centcom/agent/events';
const bus = createAgentBus({ onError: (e, event) => log.warn('bus.handler_failed', { event }) });
const off = bus.on('agent:state_changed', (p) => ui.update(p.agent_id, p.state));
bus.emit('agent:state_changed', { agent_id, state: 'thinking', since: new Date().toISOString() });
```

## Rules

- **One bus per owner.** There is no global bus and no module-level state; the runner creates its own and passes it down.
- **Order.** Handlers run synchronously in registration order. A handler added while an event is being delivered is not called for that event.
- **Re-entrancy.** An `emit` from inside a handler is queued and delivered after every handler of the current event has returned (FIFO). The queue holds 10,000 events; beyond that events are dropped and `onError` gets a `BusOverflow` on the first drop and then once per 1,000.
- **Errors never vanish.** A throwing handler, or one that returns a rejected promise, goes to `onError(err, eventName)` and the other handlers still run. `emit` does not wait for async handlers.
- **Streams** (`bus.stream(['a','b'], { buffer: 1000, overflow: 'drop-oldest' })`) are for consumers that may fall behind. They subscribe immediately, keep at most `buffer` events, count what they dropped (`stream.dropped`), and release their listeners when you `return()` or leave the `for await`. A stream you never finish is a leak.
- **Leaks.** The 101st listener for one event reports `MaxListeners` once and is still registered.

## Wire-safe events

Internal events may carry text and paths for the local UI. Only these carry nothing but ids, enums and timestamps and may become wire frames: `agent:approval_needed`, `agent:approval_resolved`, `agent:state_changed` (`WIRE_SAFE_EVENTS`). Fields marked `wire-safe` in `catalogue.ts` are the ones the session layer may copy.

Event names (`domain:verb`) are internal, not part of any contract, and other lanes depend on them: rename only with those lanes.
