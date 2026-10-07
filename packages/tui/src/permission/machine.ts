/** The keys of one permission prompt as a small state machine: keys ignored just after it appears, a two-step confirmation for risky ones, expiry. Time is injected. */
import type { ApprovalDecisionInput, ApprovalView, Scope } from './model.js';

export const GRACE_MS = 300; export const CONFIRM_MS = 5000;
export type Phase = 'active' | 'confirming' | 'editing' | 'expired' | 'done';
export interface MachineState { phase: Phase; message?: string; remainingMs: number }
export interface Machine { key(k: string): void; tick(): MachineState; state(): MachineState; setEdited(cmd: string): void }
export function createPromptMachine(d: { view: ApprovalView; canDecide: boolean; now: () => number; onDecide: (x: ApprovalDecisionInput) => void; onEdit?: (cmd: string) => void }): Machine {
  const shown = d.now(); const expires = Date.parse(d.view.expiresAt); let phase: Phase = 'active'; let confirmAt = 0; let pending: Scope | undefined; let message: string | undefined;
  const risky = d.view.risk === 'high' || d.view.destructive; const send = (x: Omit<ApprovalDecisionInput, 'approvalId'>) => { if (phase === 'done' || phase === 'expired') return; phase = 'done'; d.onDecide({ approvalId: d.view.approvalId, ...x }); };
  const state = (): MachineState => ({ phase, message, remainingMs: Math.max(0, expires - d.now()) });
  function tick(): MachineState {
    const t = d.now(); if (phase === 'confirming' && t - confirmAt > CONFIRM_MS) { phase = 'active'; pending = undefined; message = undefined; }
    if ((phase === 'active' || phase === 'confirming' || phase === 'editing') && t >= expires) { phase = 'done'; message = 'Expired'; d.onDecide({ approvalId: d.view.approvalId, decision: 'deny', scope: 'once', reason: 'expired' }); phase = 'expired'; } return state();
  }
  return {
    state, tick, setEdited(cmd) { if (phase === 'editing' && d.view.editable) send({ decision: 'approve', scope: 'once', editedCommand: cmd }); },
    key(k) {
      tick(); if (!d.canDecide || phase === 'done' || phase === 'expired') return; if (d.now() - shown < GRACE_MS) return; /* a key typed just as the prompt appeared was meant for something else */
      const key = k.toLowerCase();
      if (phase === 'confirming') { if (key === 'return' || key === 'enter') { const s = pending!; send({ decision: 'approve', scope: s }); } else if (key === 'n' || key === 'escape' || key === 'esc') send({ decision: 'deny', scope: 'once', reason: 'user' }); else { phase = 'active'; pending = undefined; message = undefined; } return; }
      if (key === 'n' || key === 'escape' || key === 'esc') { send({ decision: 'deny', scope: 'once', reason: 'user' }); return; }
      if (key === 'e') { if (d.view.editable && d.onEdit) { phase = 'editing'; d.onEdit(d.view.command ?? ''); } return; }
      const scope: Scope | undefined = key === 'y' ? 'once' : key === 's' ? 'session' : key === 'a' ? 'always' : undefined; if (!scope || !d.view.allowedScopes.includes(scope)) return;
      if (risky) { phase = 'confirming'; pending = scope; confirmAt = d.now(); message = 'Type y then Enter to confirm.'; return; } send({ decision: 'approve', scope });
    },
  };
}
