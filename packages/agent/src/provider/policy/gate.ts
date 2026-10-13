import type { LoginKind } from '../../types.js';
import { engineFlag, readFlag, type FlagSource } from './flags.js';
import type { SessionMode } from './who-pays.js';

export interface GateInput { engine: string; mode: SessionMode; loginKind: LoginKind; flags?: FlagSource; /** The host has confirmed the subscription notice for this session. */ hostConfirmed?: boolean }
export type GateBlockCode = 'provider_method_disabled' | 'provider_policy_blocked';
/** Message-table keys for the notice a block shows (the text lives in packages/tui/src/provider/messages.ts). */
export const GATE_NOTICE_KEYS = { provider_policy_blocked: 'provider.blocked.cp_subscription', provider_method_disabled: 'provider.blocked.method_disabled' } as const satisfies Record<GateBlockCode, string>;
export type GateResult =
  | { allowed: true }
  | { allowed: false; error: GateBlockCode; state: 'provider-policy-blocked'; noticeKey: string }
  | { allowed: false; needs: 'host_confirmation'; engine: string };
const blocked = (error: GateBlockCode): GateResult => ({ allowed: false, error, state: 'provider-policy-blocked', noticeKey: GATE_NOTICE_KEYS[error] });
/** Only these two kinds are known to be safe to share; anything else (missing, misspelt, from a newer build) is treated as a subscription. */
const isShareSafe = (k: unknown): boolean => k === 'api_key' || k === 'cloud';
/**
 * Run before any engine starts and before any guest prompt is claimed. Running sessions are never stopped by this: it only decides about new work.
 * 1. method flag off -> disabled; 2. command post + subscription (unknown or missing counts as subscription) + flag off -> blocked;
 * 3. command post + subscription + flag on + not confirmed -> needs host confirmation; 4. otherwise allowed (API key and cloud logins are fine in a command post).
 * Anything that cannot be read resolves to blocked, never to allowed: any mode other than `branch` is treated as a command post.
 */
export function evaluateStartGate(i: GateInput): GateResult {
  const f = engineFlag(i.engine); if (f && !readFlag(i.flags, f)) return blocked('provider_method_disabled');
  if (i.mode !== 'branch' && !isShareSafe(i.loginKind)) {
    if (!readFlag(i.flags, 'provider.command_post.subscription')) return blocked('provider_policy_blocked');
    if (i.hostConfirmed !== true) return { allowed: false, needs: 'host_confirmation', engine: i.engine };
  }
  return { allowed: true };
}
/** Every way new work can reach an engine. The same gate answers for all of them (the block must hold on every path). */
export const GATE_PATHS = ['new_session', 'host_handoff', 'failover', 'queue_approval', 'auto_approve', 'guest_prompt'] as const;
export type GatePath = (typeof GATE_PATHS)[number];
/** The gate for one path. Auto-approve and queue approval never skip it; an unknown path is blocked. */
export function evaluatePathGate(path: GatePath, i: GateInput): GateResult {
  if (!GATE_PATHS.includes(path)) return blocked('provider_policy_blocked');
  return evaluateStartGate(i);
}
