/** DESIGN.md 11.2: the lowest tier first. Agents that need a person come first. */
export type Tier = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
const TIERS: Record<Tier, string[]> = {
  1: ['crash', 'error', 'auth-required', 'session-expired', 'offline', 'provider-auth-required'], 2: ['awaiting-approval', 'asking-question', 'merge-conflict'],
  3: ['rate-limited', 'quota-reached', 'context-full', 'cost-alert', 'provider-cap-reached', 'provider-policy-blocked', 'reconnecting', 'warning', 'tests-fail', 'ci-fail', 'denied'],
  4: ['tool-running', 'editing-file', 'running-command', 'streaming', 'thinking', 'thinking-hard', 'planning', 'searching', 'reading-file', 'creating-file', 'deleting-file', 'prompt-received', 'sub-agent'],
  5: ['ci-running', 'ci-pass', 'pr-open', 'pr-merged', 'deploying', 'tests-pass'], 6: ['background-task', 'compacting', 'saving'],
  7: ['teammate-joins', 'teammate-leaves', 'teammate-typing', 'host-session', 'message-queued', 'pair-working', 'high-five', 'welcome-teammate', 'handoff', 'approved', 'success', 'celebrate', 'update-available', 'online'], 8: ['idle', 'ready', 'sleeping', 'away', 'listening', 'empty', 'no-results', 'first-run'],
};
const BY = new Map<string, Tier>(); for (const [t, l] of Object.entries(TIERS)) for (const s of l) BY.set(s, Number(t) as Tier);
export const priorityOf = (s: string): Tier => BY.get(s) ?? 4; export const allTiered = (): string[] => [...BY.keys()];
/** What the card says besides colour: a glyph and a word. */
export function glyphFor(state: string, exited?: boolean): string { if (exited) return '■'; const t = priorityOf(state); if (state === 'awaiting-approval' || state === 'asking-question') return '?'; if (state === 'merge-conflict' || t === 1 || t === 3) return '!'; if (t === 4) return '▶'; if (t === 5 || t === 6) return '…'; return '·'; }
