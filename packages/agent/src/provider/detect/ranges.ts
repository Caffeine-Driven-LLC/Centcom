import type { EngineId } from '../../types.js';
/** Placeholders until the engine lanes record real transcripts. Corrected there, not guessed here. */
export const SUPPORTED_RANGES: Record<'claude-code' | 'codex', string> = { 'claude-code': '>=2.0.0 <3.0.0', codex: '>=0.40.0 <1.0.0' };
export const rangeFor = (id: EngineId): string => (id === 'claude-code' || id === 'codex' ? SUPPORTED_RANGES[id] : '');
