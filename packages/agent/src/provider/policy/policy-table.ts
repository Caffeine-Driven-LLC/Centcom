import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { registerStatusSection } from '../detect/doctor-checks.js';
import { PROVIDER_FLAGS, readFlag, type FlagSource, type ProviderFlagKey } from './flags.js';

export interface PolicyMethod { id: string; provider: 'anthropic' | 'openai' | 'other'; status: 'allowed' | 'allowed_with_conditions' | 'not_permitted' | 'pending_confirmation'; flag: string; engine?: string; source: string; conditions?: string[] }
export interface ProviderPolicy { checked_at: string; methods: PolicyMethod[] }
const FILE = fileURLToPath(new URL('../../../data/provider-policy.json', import.meta.url));
/** The policy table shipped with the client (content equal to the reference rows in contracts/fixtures/providers/policy-reference.json). */
export function loadProviderPolicy(path = FILE): ProviderPolicy { return JSON.parse(readFileSync(path, 'utf8')) as ProviderPolicy; }
const flagText = (src: FlagSource | undefined, key: string): string => (key in PROVIDER_FLAGS ? (readFlag(src, key as ProviderFlagKey) ? 'on' : 'off') : 'not a client flag');
/** One line per method: id, status, flag value now, conditions, source. */
export function policyLines(p: ProviderPolicy, src?: FlagSource): string[] {
  return p.methods.map((m) => `${m.id}  ${m.status}  ${m.flag}=${flagText(src, m.flag)}${m.conditions?.length ? `  [${m.conditions.join('; ')}]` : ''}  ${m.source}`);
}
/** Adds the policy section to `centcom provider status --policy`. */
export function registerPolicyStatusSection(src?: FlagSource, load: () => ProviderPolicy = loadProviderPolicy): void {
  registerStatusSection({ id: 'policy', render: () => policyLines(load(), src), json: () => ({ checked_at: load().checked_at, methods: load().methods.map((m) => ({ id: m.id, status: m.status, flag: m.flag, value: flagText(src, m.flag), conditions: m.conditions ?? [], source: m.source })) }) });
}
