import { createBus, type BusOptions, type EventBus } from './bus.js';
import type { AgentEventMap } from './catalogue.js';
export * from './bus.js';
export * from './catalogue.js';
export type AgentBus = EventBus<AgentEventMap>;
export const createAgentBus = (o: BusOptions): AgentBus => createBus<AgentEventMap>(o);
