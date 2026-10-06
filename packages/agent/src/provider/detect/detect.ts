import { ProviderError, type EngineId, type ProviderErrorCode } from '../../types.js';
import type { RunnerClock } from '../../runner/types.js';
import { classifyClaudeAuth, classifyLogin, effectiveKind } from './classify.js';
import type { RunFn, WhichFn } from './probe.js';
import { rangeFor } from './ranges.js';
import { commandName } from './install-hints.js';
import { rangePosition } from './semver.js';
import type { LoginKind } from '../../types.js';

export type DetectedEngine = 'claude-code' | 'codex';
export interface ProviderStatus {
  engine: DetectedEngine; provider: 'anthropic' | 'openai'; installed: boolean; path?: string; version?: string;
  supported: 'yes' | 'below' | 'above' | 'unknown'; supported_range: string; signed_in: 'yes' | 'no' | 'unknown'; login_kind: LoginKind; effective_kind: 'subscription' | 'api_key' | 'cloud';
  checked_at: string; errors: ProviderErrorCode[];
  /** Whether this version of Claude Code has the `auth` subcommands (so login and logout can be handed over). */
  auth_command?: boolean;
}
export interface DetectDeps { run: RunFn; which: WhichFn; clock: RunnerClock; env?: Record<string, string | undefined>; log?: { debug(m: string, c?: Record<string, unknown>): void }; probeTimeoutMs?: number; overallTimeoutMs?: number }
export const PROBE_TIMEOUT_MS = 5000; export const OVERALL_TIMEOUT_MS = 15_000; const MAX_BYTES = 64 * 1024;
const PROVIDER = { 'claude-code': 'anthropic', codex: 'openai' } as const; const ENV_BIN = { 'claude-code': 'CENTCOM_CLAUDE_BIN', codex: 'CENTCOM_CODEX_BIN' } as const;

const version = (s: string) => /\d+\.\d+\.\d+/.exec(s)?.[0];

export async function detectProvider(id: EngineId, d: DetectDeps): Promise<ProviderStatus> {
  if (id !== 'claude-code' && id !== 'codex') throw new ProviderError('provider_capability_missing', id, 'Only Claude Code and Codex can be detected.');
  const env = d.env ?? process.env; const range = rangeFor(id); const base = { engine: id, provider: PROVIDER[id], supported_range: range, checked_at: new Date(d.clock.now()).toISOString() } as const;
  const path = d.which(env[ENV_BIN[id]] || commandName(id));
  if (!path) return { ...base, installed: false, supported: 'unknown', signed_in: 'unknown', login_kind: 'unknown', effective_kind: 'subscription', errors: [] };
  const t = d.probeTimeoutMs ?? PROBE_TIMEOUT_MS; const errors = new Set<ProviderErrorCode>(); const probe = (args: string[]) => d.run(path, args, { timeoutMs: t, maxBytes: MAX_BYTES });
  const bad = (r: { timedOut: boolean; tooLong: boolean }) => { if (r.timedOut || r.tooLong) errors.add('provider_protocol_error'); };
  const versionP = probe(['--version']).then((r) => { bad(r); return version(r.out); });
  let authCommand: boolean | undefined;
  const signP = (async () => {
    if (id === 'codex') { const r = await probe(['login', 'status']); bad(r); return r.timedOut || r.tooLong ? { signedIn: null, kind: 'unknown' as LoginKind } : classifyLogin(r.out, r.code); }
    const help = await probe(['auth', '--help']); bad(help); authCommand = help.code === 0 && !help.timedOut; if (!authCommand) return { signedIn: null, kind: 'unknown' as LoginKind };
    const r = await probe(['auth', 'status']); bad(r); return r.timedOut || r.tooLong ? { signedIn: null, kind: 'unknown' as LoginKind } : classifyClaudeAuth(r.out, r.code);
  })();
  let timer: unknown; const overall = new Promise<'late'>((res) => { timer = d.clock.setTimeout(() => res('late'), d.overallTimeoutMs ?? OVERALL_TIMEOUT_MS); });
  const got = await Promise.race([Promise.all([versionP, signP]), overall]); d.clock.clearTimeout(timer as never);
  let ver: string | undefined; let sign: { signedIn: boolean | null; kind: LoginKind } = { signedIn: null, kind: 'unknown' };
  if (got === 'late') errors.add('provider_protocol_error'); else { [ver, sign] = got; }
  if (!ver) errors.add('provider_protocol_error');
  const supported = rangePosition(ver, range); if (supported === 'below' || supported === 'above') errors.add('provider_version_unsupported'); if (sign.signedIn === false) errors.add('provider_not_signed_in');
  d.log?.debug('provider.detected', { engine: id, installed: true, supported, signed_in: sign.signedIn });
  return { ...base, installed: true, path, ...(ver ? { version: ver } : {}), supported, signed_in: sign.signedIn === true ? 'yes' : sign.signedIn === false ? 'no' : 'unknown', login_kind: sign.kind, effective_kind: effectiveKind(sign.kind), errors: [...errors], ...(authCommand !== undefined ? { auth_command: authCommand } : {}) };
}

export const DETECTED_ENGINES: readonly DetectedEngine[] = ['claude-code', 'codex'];
export const detectAll = (d: DetectDeps): Promise<ProviderStatus[]> => Promise.all(DETECTED_ENGINES.map((e) => detectProvider(e, d)));

export const CACHE_MS = 30_000;
export interface ProviderDetector { detect(id: DetectedEngine, o?: { refresh?: boolean }): Promise<ProviderStatus>; detectAll(o?: { refresh?: boolean }): Promise<ProviderStatus[]> }
/** Results are kept for 30 s; `refresh` asks again. Each detector owns its cache (no module-level state). */
export function createProviderDetector(d: DetectDeps): ProviderDetector {
  const cache = new Map<DetectedEngine, { at: number; p: Promise<ProviderStatus> }>();
  const detect = (id: DetectedEngine, o: { refresh?: boolean } = {}) => { const hit = cache.get(id); if (!o.refresh && hit && d.clock.now() - hit.at < CACHE_MS) return hit.p; const p = detectProvider(id, d); cache.set(id, { at: d.clock.now(), p }); return p; };
  return { detect, detectAll: (o) => Promise.all(DETECTED_ENGINES.map((e) => detect(e, o))) };
}
