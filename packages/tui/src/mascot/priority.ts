/** DESIGN 11.2: when several states apply, the one in the lowest-numbered tier is the one the mascot shows. */
export type Tier = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
const TIERS: Record<Tier, string[]> = {
  1: ["crash", "error", "auth-required", "session-expired", "offline", "provider-auth-required"],
  2: ["awaiting-approval", "asking-question", "merge-conflict"],
  3: ["rate-limited", "quota-reached", "context-full", "cost-alert", "provider-cap-reached", "provider-policy-blocked", "reconnecting", "warning", "tests-fail", "ci-fail", "denied"],
  4: ["tool-running", "editing-file", "running-command", "streaming", "thinking", "thinking-hard", "planning", "searching", "reading-file", "creating-file", "deleting-file", "prompt-received", "sub-agent"],
  5: ["ci-running", "ci-pass", "pr-open", "pr-merged", "deploying", "tests-pass"],
  6: ["background-task", "compacting", "saving"],
  7: ["teammate-joins", "teammate-leaves", "teammate-typing", "host-session", "message-queued", "pair-working", "high-five", "welcome-teammate", "handoff", "approved", "success", "celebrate", "update-available", "online"],
  8: ["idle", "ready", "sleeping", "away", "listening", "empty", "no-results", "first-run"],
};
const BY_STATE = new Map<string, Tier>(); for (const [t, list] of Object.entries(TIERS)) for (const s of list) BY_STATE.set(s, Number(t) as Tier);
/** A state this table does not know counts as ordinary work (tier 4). */
export const priorityOf = (state: string): Tier => BY_STATE.get(state) ?? 4;
export const knownState = (state: string): boolean => BY_STATE.has(state);
/** States that keep the mascot on screen by themselves (first run and empty screens). */
export const SHOWN_STATES = new Set(['first-run', 'empty', 'no-results']);
