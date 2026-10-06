import type { EngineId, ProviderErrorCode } from '../types.js';
import { commandName, installHint } from './detect/install-hints.js';
import { redactProviderText } from './detect/redact.js';

export type ProviderLocalState = 'provider-auth-required' | 'provider-cap-reached' | 'provider-policy-blocked';
export interface ProviderMessage { title: string; body: string; next_step: string; severity: 'info' | 'warn' | 'error'; state?: ProviderLocalState }
const tool = (e?: EngineId) => (e === 'codex' ? 'Codex' : e === 'claude-code' ? 'Claude Code' : 'The tool');
const MAX = 2048;

/** One calm message per provider error: what happened, what to do next. The tool's own words go in a quoted block, redacted and cut at 2 KiB. Vendor names only ever name the tool itself. */
export function providerMessage(code: ProviderErrorCode, o: { tool_message?: string; engine?: EngineId; os?: NodeJS.Platform } = {}): ProviderMessage {
  const e = o.engine; const name = tool(e); const cmd = e ? commandName(e) : 'claude';
  const base: Record<ProviderErrorCode, ProviderMessage> = {
    provider_not_installed: { title: `${name} was not found`, body: 'Centcom drives the command-line tool you install yourself, and it could not find it on this computer.', next_step: `${installHint(e ?? 'claude-code', o.os)} Then run \`centcom provider status\`.`, severity: 'error' },
    provider_not_signed_in: { title: `${name} is not signed in`, body: 'The tool says it has no active login. Centcom never handles your login; the tool does.', next_step: `Run \`centcom provider login ${e === 'codex' ? 'codex' : 'claude'}\` and finish signing in.`, severity: 'warn', state: 'provider-auth-required' },
    provider_method_disabled: { title: 'This provider is switched off for now', body: 'Using it this way is turned off in Centcom at the moment.', next_step: 'Try the other provider, or run `centcom provider status` to see what is available.', severity: 'warn', state: 'provider-policy-blocked' },
    provider_policy_blocked: { title: 'This is not allowed by your provider settings', body: 'A policy, either the provider\'s or your organisation\'s, blocks this action.', next_step: 'Ask the person who manages your account, or run `centcom provider status --policy` to see which rule applies.', severity: 'error', state: 'provider-policy-blocked' },
    provider_cap_reached: { title: 'You reached your plan\'s usage limit', body: 'The provider stopped the request because the limit for your plan is used up.', next_step: 'Wait for the reset time shown in the status line, or switch to the other provider with `centcom provider status`.', severity: 'warn', state: 'provider-cap-reached' },
    provider_rate_limited: { title: 'Too many requests right now', body: 'The provider asked Centcom to slow down for a moment.', next_step: 'Wait a few seconds and send the message again; Centcom retries on its own where it is safe.', severity: 'info' },
    provider_version_unsupported: { title: `${name} is a version Centcom does not support`, body: 'Centcom has only been checked against a range of versions, and this one is outside it.', next_step: `Update the tool (${installHint(e ?? 'claude-code', o.os)}) and run \`centcom provider status\`.`, severity: 'warn' },
    provider_protocol_error: { title: `${name} answered in a way Centcom could not read`, body: 'Something unexpected came back from the tool, so Centcom stopped that step.', next_step: `Run \`centcom provider doctor\`. If it keeps happening, update the tool with \`${cmd} --version\` as a first check.`, severity: 'error' },
    provider_capability_missing: { title: `${name} cannot do that`, body: 'The tool does not support the feature you asked for.', next_step: 'Pick the other provider for this task, or update the tool and run `centcom provider status`.', severity: 'info' },
  };
  const m = { ...base[code] };
  if (o.tool_message) { const q = redactProviderText(o.tool_message).slice(0, MAX).split('\n').map((l) => `> ${l}`).join('\n'); m.body = `${m.body}\n\nThe tool said:\n${q}`; }
  return m;
}
export const ALL_PROVIDER_CODES: readonly ProviderErrorCode[] = ['provider_not_installed', 'provider_not_signed_in', 'provider_method_disabled', 'provider_policy_blocked', 'provider_cap_reached', 'provider_rate_limited', 'provider_version_unsupported', 'provider_protocol_error', 'provider_capability_missing'];
