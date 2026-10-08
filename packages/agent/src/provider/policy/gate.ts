import type { LoginKind } from '../../types.js';
import { engineFlag, readFlag, type FlagSource } from './flags.js';
import type { SessionMode } from './who-pays.js';

export interface GateInput { engine: string; mode: SessionMode; loginKind: LoginKind; flags?: FlagSource; /** The host has confirmed the subscription notice for this session. */ hostConfirmed?: boolean }
export type GateResult = { allowed: true } | { allowed: false; code: 'provider_method_disabled' | 'provider_policy_blocked' } | { allowed: false; needs: 'host_confirmation' };
/**
 * Run before any engine starts and before any guest prompt is claimed. Running sessions are never stopped by this: it only decides about new work.
 * 1. method flag off -> disabled; 2. command post + subscription (unknown counts as subscription) + flag off -> blocked;
 * 3. command post + subscription + flag on + not confirmed -> needs host confirmation; 4. otherwise allowed (API key and cloud logins are fine in a command post).
 */
export function evaluateStartGate(i: GateInput): GateResult {
  const f = engineFlag(i.engine); if (f && !readFlag(i.flags, f)) return { allowed: false, code: 'provider_method_disabled' };
  if (i.mode === 'command_post' && (i.loginKind === 'subscription' || i.loginKind === 'unknown')) {
    if (!readFlag(i.flags, 'provider.command_post.subscription')) return { allowed: false, code: 'provider_policy_blocked' };
    if (!i.hostConfirmed) return { allowed: false, needs: 'host_confirmation' };
  }
  return { allowed: true };
}
