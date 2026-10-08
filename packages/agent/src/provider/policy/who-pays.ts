import type { EngineId, LoginKind, ProviderId } from '../../types.js';
import type { MemberId } from '../../events/index.js';

export type SessionMode = 'branch' | 'command_post';
/** `claude-code` -> anthropic, `codex` -> openai, anything else -> other. */
export const providerOf = (engine: EngineId | string): ProviderId => (engine === 'claude-code' ? 'anthropic' : engine === 'codex' ? 'openai' : 'other');
export interface WhoPaysInput { mode: SessionMode; engine: EngineId | string; loginKind: LoginKind; /** The agent's owner (the member whose machine runs it). */ owner: MemberId; /** The session host. */ host: MemberId; /** The member who typed the prompt. */ prompter: MemberId }
export interface WhoPays { payer: MemberId; provider: ProviderId; login_kind: LoginKind; shared: boolean }
/** Branch mode: the agent's owner pays. Command post: the host pays. `shared` when the payer is not the person who typed the prompt. */
export function computeWhoPays(i: WhoPaysInput): WhoPays {
  const payer = i.mode === 'command_post' ? i.host : i.owner;
  return { payer, provider: providerOf(i.engine), login_kind: i.loginKind, shared: payer !== i.prompter };
}
/** The only provider fields in the clear part of `agent.spawn` (CT-PROVIDER 5). Model, engine id and version go in the encrypted part. */
export function buildSpawnClearFields(w: Pick<WhoPays, 'payer' | 'provider'>): { runs_on: MemberId; provider: ProviderId } { return { runs_on: w.payer, provider: w.provider }; }
