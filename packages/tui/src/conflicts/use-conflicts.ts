import { useSyncExternalStore } from 'react';
import type { ConflictSource, ConflictSnapshot } from './model.js';
/** The current locks and conflicts; it re-renders only when the source says something changed. */
export function useConflicts(source: ConflictSource): ConflictSnapshot { return useSyncExternalStore((fn) => source.subscribe(fn), () => source.getSnapshot(), () => source.getSnapshot()); }
