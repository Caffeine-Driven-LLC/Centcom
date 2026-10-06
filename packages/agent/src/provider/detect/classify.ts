import type { LoginKind } from '../../types.js';
import { redactProviderText } from './redact.js';

export const MAX_PROBE_TEXT = 4096;
/** Reads the tool's own words about how it is signed in. Only the classification is kept. Never throws, whatever the bytes. */
export function classifyLogin(output: string, exitCode: number | null): { signedIn: boolean | null; kind: LoginKind } {
  const text = redactProviderText(String(output ?? '').slice(0, MAX_PROBE_TEXT));
  if (/not (logged|signed) in|logged out|no (active )?(login|credentials)/i.test(text)) return { signedIn: false, kind: 'unknown' };
  if (!text.trim()) return { signedIn: exitCode === 0 ? null : exitCode === null ? null : false, kind: 'unknown' };
  const kind: LoginKind = /bedrock|vertex|foundry|cloud/i.test(text) ? 'cloud' : /api[ -]?key/i.test(text) ? 'api_key' : /chatgpt|subscription|claude (ai |account)|claude\.ai/i.test(text) ? 'subscription' : 'unknown';
  if (exitCode !== null && exitCode !== 0) return { signedIn: false, kind: 'unknown' };
  return { signedIn: kind === 'unknown' ? (exitCode === 0 ? true : null) : true, kind };
}
/** Unknown counts as a subscription: the careful default (CT-PROVIDER 4). */
export const effectiveKind = (k: LoginKind): 'subscription' | 'api_key' | 'cloud' => (k === 'unknown' ? 'subscription' : k);

/** `claude auth status` prints JSON; only `authMethod` is read from it. */
export function classifyClaudeAuth(out: string, exitCode: number | null): { signedIn: boolean | null; kind: LoginKind } {
  let j: unknown; try { j = JSON.parse(String(out).slice(0, MAX_PROBE_TEXT)); } catch { return { signedIn: null, kind: 'unknown' }; }
  const method = (j as { authMethod?: unknown } | null)?.authMethod; if (typeof method !== 'string') return { signedIn: null, kind: 'unknown' };
  if (method === 'none' || (exitCode !== null && exitCode !== 0)) return { signedIn: false, kind: 'unknown' };
  if (method === 'claude.ai' || method === 'oauth_token') return { signedIn: true, kind: 'subscription' };
  if (method === 'api_key' || method === 'api_key_helper') return { signedIn: true, kind: 'api_key' };
  if (method === 'third_party') return { signedIn: true, kind: 'cloud' };
  return { signedIn: true, kind: 'unknown' };
}
