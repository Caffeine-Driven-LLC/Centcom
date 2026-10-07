/** Every line of text this lane shows lives here (a table, not strings inside components). */
export const MSG = {
  locked: (label: string) => `! locked ${label}`, heldBy: (who: string) => `held by ${who}`, held: 'held', secondsLeft: (n: number) => `${n}s left`, waiting: (who: string) => `${who} waiting`, anAgent: 'an agent', someone: 'someone',
  conflict: (files: string) => `! conflict in ${files}`, between: (a: string) => `between ${a}`, more: (n: number) => `+${n} more`, none: 'No locks held.',
  wait: 'Wait', takeTurns: 'Take turns', branchOff: 'Branch off', resolve: 'Resolve with Cento',
  pending: 'Working on it…', pendingReason: 'Another action is running.',
  confirmResolve: 'Resolve with Cento? This changes your files. Press y to confirm, n to cancel.',
  failed: (why: string) => `Could not do that: ${why}`,
} as const;
export const ACTIONS = [{ id: 'wait', key: 'w', label: MSG.wait }, { id: 'take-turns', key: 't', label: MSG.takeTurns }, { id: 'branch-off', key: 'b', label: MSG.branchOff }, { id: 'resolve-with-cento', key: 'r', label: MSG.resolve }] as const;
export type ResolveAction = (typeof ACTIONS)[number]['id'];
