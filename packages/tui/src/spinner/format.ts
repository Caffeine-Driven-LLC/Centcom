/** `1.4k`, `12k`, `1.2M`. */
export function formatTokens(n: number): string { if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'; if (n >= 10_000) return Math.round(n / 1000) + 'k'; if (n >= 1000) return (n / 1000).toFixed(1) + 'k'; return String(Math.max(0, Math.floor(n))); }
/** `12s`, `1m05s`, `1h02m`. */
export function formatElapsed(ms: number): string { const s = Math.max(0, Math.floor(ms / 1000)); if (s < 60) return `${s}s`; const m = Math.floor(s / 60); if (m < 60) return `${m}m${String(s % 60).padStart(2, '0')}s`; return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`; }
export type LoadingPattern = 'none' | 'dim' | 'spinner' | 'spinner-mascot' | 'spinner-long';
/** DESIGN 9.4: under 100 ms nothing, then a dim target, from 1 s a spinner with a verb, from 8 s the mascot may join, from 30 s the long form. */
export function loadingPattern(ms: number): LoadingPattern { if (ms < 100) return 'none'; if (ms < 1000) return 'dim'; if (ms < 8000) return 'spinner'; if (ms < 30_000) return 'spinner-mascot'; return 'spinner-long'; }
