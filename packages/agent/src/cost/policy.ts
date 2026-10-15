/**
 * Which model, effort and sub-agent model a Claude Code turn runs on when the person has not said. Owns the default and the rules around
 * it; it must not override anything the person chose (`--model`, `/model`, a remembered pick, their own CLAUDE_CODE_SUBAGENT_MODEL).
 */
export type Tier = 'haiku' | 'sonnet' | 'opus' | 'fable' | 'other';
/** The price tier of a model id or alias. */
export function tierOf(model: string | undefined): Tier {
  const m = (model ?? '').toLowerCase(); return m.includes('haiku') ? 'haiku' : m.includes('sonnet') ? 'sonnet' : m.includes('opus') ? 'opus' : m.includes('fable') ? 'fable' : 'other';
}
const RANK: Record<Tier, number> = { haiku: 0, sonnet: 1, opus: 2, fable: 3, other: 1 };
/** True for the models that cost the most per token (Opus and above): the ones Centcom only uses when asked. */
export const isTopTier = (model: string | undefined): boolean => RANK[tierOf(model)] >= 2;

export interface ModelPolicyInput {
  /** What the person chose for this run: `--model`, `/model`, or a pick remembered from an earlier run. Empty = nothing chosen. */
  chosen?: string;
  /** `agent.model`, `agent.effort`, `agent.subagent_model`. */
  config: { model: string; effort: string; subagent_model: string };
  /** The person's own CLAUDE_CODE_SUBAGENT_MODEL, if set. */
  envSubagentModel?: string;
}
export interface ModelPolicy {
  /** Passed as `--model`; empty = pass nothing (Claude Code's own default). */
  model: string;
  source: 'chosen' | 'config';
  /** Passed as `--effort`; empty = pass nothing. */
  effort: string;
  /** Set as CLAUDE_CODE_SUBAGENT_MODEL; empty = leave it alone. */
  subagentModel: string;
}

/** Resolves the policy. An explicit choice always wins and is used as given. Effort is not sent to Haiku, which does not take it. A sub-agent model dearer than the main one is not set (helpers never cost more than the conversation). */
export function resolveModelPolicy(i: ModelPolicyInput): ModelPolicy {
  const chosen = i.chosen?.trim() ?? ''; const model = chosen || i.config.model.trim(); const source = chosen ? 'chosen' : 'config';
  const effort = tierOf(model) === 'haiku' ? '' : i.config.effort.trim();
  let sub = (i.envSubagentModel ?? '').trim() ? '' : i.config.subagent_model.trim(); // their own variable is theirs
  if (sub && model && RANK[tierOf(sub)] > RANK[tierOf(model)] && tierOf(sub) !== 'other') sub = '';
  return { model, source, effort, subagentModel: sub };
}
