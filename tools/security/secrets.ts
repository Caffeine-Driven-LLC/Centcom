/** Secret scan: Centcom keys, JWTs and private keys in tracked files. A line carrying the marker `centcom-synthetic-secret` is a labelled test value and is skipped. */
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { result, unavailable, type CheckResult, type Finding } from './types.js';

export const SYNTHETIC_MARKER = 'centcom-synthetic-secret';
const DASH = '-'.repeat(5);
export const RULES: { id: string; re: RegExp; message: string }[] = [
  { id: 'centcom-live-key', re: /\bcen_live_[A-Za-z0-9]{8,}/, message: 'a live Centcom API key' },
  { id: 'centcom-test-key', re: /\bcen_test_[A-Za-z0-9]{8,}/, message: 'a Centcom test API key' },
  { id: 'jwt', re: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/, message: 'a JSON web token' },
  { id: 'private-key', re: new RegExp(`${DASH}BEGIN (?:[A-Z]+ )?PRIVATE KEY(?: BLOCK)?${DASH}`), message: 'a private key block' },
];
export function scanText(path: string, text: string): Finding[] {
  const out: Finding[] = []; const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) { const l = lines[i]!; if (l.length > 20_000 || l.includes(SYNTHETIC_MARKER)) continue; for (const r of RULES) if (r.re.test(l)) out.push({ severity: 'high', location: `${path}:${i + 1}`, message: `${r.message} (${r.id})` }); }
  return out;
}
const SKIP = /\.(png|jpe?g|gif|ico|woff2?|ttf|otf|zip|gz|lock|svg)$/i; const MAX = 2 * 1024 * 1024;
/** Files that hold labelled test values for the redaction tests, listed with a reason in policy.json (exact paths). */
export interface SecretsPolicy { allow: { path: string; reason: string }[] }
export function scanFiles(root: string, files: string[], policy: SecretsPolicy = { allow: [] }): Finding[] {
  const out: Finding[] = []; const skip = new Set(policy.allow.map((a) => a.path)); for (const f of files) { if (SKIP.test(f) || skip.has(f)) continue; try { const p = join(root, f); if (statSync(p).size > MAX) continue; out.push(...scanText(f, readFileSync(p, 'utf8'))); } catch { /* unreadable or deleted file */ } } return out;
}
export const trackedFiles = (root: string): string[] => execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\0').filter(Boolean);
export function checkSecrets(root: string, files?: () => string[], policy?: SecretsPolicy): CheckResult { try { return result('secrets', scanFiles(root, (files ?? (() => trackedFiles(root)))(), policy)); } catch (e) { return unavailable('secrets', (e as Error).message); } }
