import { createBus, type BusOptions, type EventBus } from './bus.js';
import type { AgentEventMap } from './catalogue.js';
export * from './bus.js';
export * from './catalogue.js';
export type AgentBus = EventBus<AgentEventMap>;
/** Only streamed text and snapshots that a later one replaces may be lost by a slow reader; approvals, tool results, turns and lifecycle events never are. */
const LOSSY = new Set(['text.delta', 'thinking.delta', 'subagent.text', 'status', 'usage.report', 'limits.report']);
export const agentDroppable = (k: string, p: unknown): boolean => k === 'agent:message_delta' || k === 'agent:context' || k === 'progress' || (k === 'agent:event' && LOSSY.has(((p as { event?: { type?: string } })?.event?.type) ?? ''));
export const createAgentBus = (o: BusOptions): AgentBus => createBus<AgentEventMap>({ droppable: agentDroppable, ...o });
