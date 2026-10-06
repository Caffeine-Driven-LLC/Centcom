import { readdir, stat, open } from 'node:fs/promises';
import { join } from 'node:path';
import type { ProviderDetector, DetectedEngine } from './detect.js';
import { installHint, manualLogin } from './install-hints.js';
import { leakIds } from './redact.js';

export type DoctorStatus = 'ok' | 'warn' | 'fail' | 'skip';
export interface DoctorResult { status: DoctorStatus; message: string; next_step?: string }
export interface DoctorCtx { detector: ProviderDetector; now(): number; os?: NodeJS.Platform; logDir?: string; /** ISO time of the bundled provider policy. */ policyCheckedAt?: string }
export interface DoctorCheck { id: string; title: string; run(ctx: DoctorCtx): Promise<DoctorResult> }

const NAME: Record<DetectedEngine, string> = { 'claude-code': 'Claude Code', codex: 'Codex' };
const check = (engine: DetectedEngine, kind: 'installed' | 'version' | 'signed_in'): DoctorCheck => ({
  id: `provider.${engine === 'claude-code' ? 'claude' : 'codex'}.${kind}`, title: `${NAME[engine]}: ${kind.replace('_', ' ')}`,
  async run(ctx) {
    const s = await ctx.detector.detect(engine);
    if (kind === 'installed') return s.installed ? { status: 'ok', message: `${NAME[engine]} found` } : { status: 'warn', message: `${NAME[engine]} was not found`, next_step: `${installHint(engine, ctx.os)} Then run \`centcom provider status\`.` };
    if (!s.installed) return { status: 'skip', message: 'not installed' };
    if (kind === 'version') return s.supported === 'yes' ? { status: 'ok', message: `version ${s.version} is supported` } : { status: 'warn', message: s.version ? `version ${s.version} is ${s.supported === 'unknown' ? 'not recognised' : s.supported === 'below' ? 'older than supported' : 'newer than checked'} (supported: ${s.supported_range})` : 'the version could not be read', next_step: 'Update the tool, then run `centcom provider status`.' };
    return s.signed_in === 'yes' ? { status: 'ok', message: `signed in (${s.login_kind === 'unknown' ? 'subscription assumed' : s.login_kind})` } : s.signed_in === 'no' ? { status: 'warn', message: 'not signed in', next_step: `Run \`centcom provider login ${engine === 'codex' ? 'codex' : 'claude'}\` (or \`${manualLogin(engine)}\`).` } : { status: 'ok', message: 'sign-in will be checked when the first agent starts' };
  },
});

const DAY = 86_400_000; export const POLICY_MAX_AGE_DAYS = 180; export const LEAK_SCAN_BYTES = 500 * 1024;
export const providerDoctorChecks: DoctorCheck[] = [
  check('claude-code', 'installed'), check('claude-code', 'version'), check('claude-code', 'signed_in'), check('codex', 'installed'), check('codex', 'version'), check('codex', 'signed_in'),
  { id: 'provider.policy.fresh', title: 'Provider policy is recent', async run(ctx) {
    const t = ctx.policyCheckedAt ? Date.parse(ctx.policyCheckedAt) : NaN; if (Number.isNaN(t)) return { status: 'warn', message: 'the bundled policy has no check date', next_step: 'Update Centcom.' };
    const age = Math.floor((ctx.now() - t) / DAY); return age > POLICY_MAX_AGE_DAYS ? { status: 'warn', message: `the bundled provider policy was checked ${age} days ago`, next_step: 'Update Centcom to get the current policy.' } : { status: 'ok', message: `policy checked ${age} days ago` };
  } },
  { id: 'provider.leak_scan', title: 'No credentials in Centcom\'s own logs', async run(ctx) {
    if (!ctx.logDir) return { status: 'skip', message: 'no log folder' }; let names: string[]; try { names = (await readdir(ctx.logDir)).filter((n) => /\.log/.test(n)); } catch { return { status: 'skip', message: 'no logs yet' }; }
    const hits = new Set<string>(); for (const n of names) { const f = join(ctx.logDir, n); const size = (await stat(f)).size; const fh = await open(f, 'r'); try { const len = Math.min(size, LEAK_SCAN_BYTES); const buf = Buffer.alloc(len); await fh.read(buf, 0, len, size - len); for (const id of leakIds(buf.toString('utf8'))) hits.add(id); } finally { await fh.close(); } }
    return hits.size ? { status: 'fail', message: `a credential-shaped string was found in the logs (${[...hits].join(', ')})`, next_step: 'Delete the log files, run `centcom doctor --bundle` to report it, and do not share them.' } : { status: 'ok', message: 'no credential patterns in the last 500 KiB of logs' };
  } },
];
const sections: { id: string; render(ctx: unknown): string[]; json(ctx: unknown): unknown }[] = [];
/** C105 attaches its who-pays section to `centcom provider status --policy` here. */
export function registerStatusSection(s: { id: string; render(ctx: unknown): string[]; json(ctx: unknown): unknown }): void { if (!sections.some((x) => x.id === s.id)) sections.push(s); }
export const statusSections = () => [...sections];
