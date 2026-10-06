import { effectiveKind, installHint, redactProviderText, statusSections, type ProviderStatus } from '@centcom/agent';

const NAME = { 'claude-code': 'claude-code', codex: 'codex' } as const;
/** One short line per engine, e.g. `claude-code  installed 2.1.0 (supported)  signed in (subscription)`. */
export function statusLine(s: ProviderStatus): string {
  if (!s.installed) return `${NAME[s.engine]}  not installed`;
  const ver = s.version ? `installed ${s.version} (${s.supported === 'yes' ? 'supported' : s.supported === 'unknown' ? 'support unknown' : s.supported === 'below' ? 'older than supported' : 'newer than checked'})` : 'installed (version unknown)';
  const login = s.signed_in === 'yes' ? `signed in (${s.login_kind === 'unknown' ? 'subscription assumed' : s.login_kind})` : s.signed_in === 'no' ? 'not signed in' : 'sign-in checked when an agent starts';
  return `${NAME[s.engine]}  ${ver}  ${login}`;
}
export function nextStepLine(s: ProviderStatus, os?: NodeJS.Platform): string | undefined {
  if (!s.installed) return `  ${installHint(s.engine, os)}`; if (s.signed_in === 'no') return `  Run \`centcom provider login ${s.engine === 'codex' ? 'codex' : 'claude'}\`.`;
  if (s.supported === 'below' || s.supported === 'above') return `  Supported versions: ${s.supported_range}. Update the tool, then run \`centcom provider status --refresh\`.`; return undefined;
}
export const hasWarning = (s: ProviderStatus) => !s.installed || s.signed_in === 'no' || s.supported === 'below' || s.supported === 'above';
export const statusJson = (providers: ProviderStatus[], policy?: unknown) => JSON.stringify(JSON.parse(redactProviderText(JSON.stringify({ schema_version: 1, providers: providers.map((p) => ({ ...p, effective_kind: effectiveKind(p.login_kind) })), ...(policy ? { policy } : {}) }))), null, 2);
export const policyLines = (ctx: unknown): string[] => statusSections().flatMap((s) => [`${s.id}:`, ...s.render(ctx).map((l) => `  ${l}`)]);
export const policyJson = (ctx: unknown): Record<string, unknown> => Object.fromEntries(statusSections().map((s) => [s.id, s.json(ctx)]));
