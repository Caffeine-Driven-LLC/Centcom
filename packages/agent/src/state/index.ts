export * from './mapping.js';
export * from './machine.js';
export * from './emitter.js';
export * from './attach.js';
import type { StateName } from '@centcom/protocol';
import type { AgentWireState } from '@centcom/protocol';
/** Client-local UI states (connectivity, account, provider, limits, social): never produced by the machine and never sent. */
export type LocalUiState = Exclude<StateName, AgentWireState>;
