export { ConflictStore, cardState, fileLabel, secondsLeft, type ConflictSource, type ConflictSnapshot, type ConflictEvent, type LockView, type ConflictView, type StoreLogger } from './model.js';
export { ConflictBanner, ConflictStack, errorText, type ConflictBannerProps } from './ConflictBanner.js';
export { LockInspector, LockChip, lockLine, type LockViewProps, type WhoIs } from './LockInspector.js';
export { useConflicts } from './use-conflicts.js';
export { MSG as CONFLICT_MESSAGES, ACTIONS as CONFLICT_ACTIONS, type ResolveAction } from './messages.js';
