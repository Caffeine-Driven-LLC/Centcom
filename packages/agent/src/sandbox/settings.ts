import type { PolicyMode } from '../permissions/types.js';
import { posix, win32 } from 'node:path';
import { PROTECTED_PATHS } from './protected.js';

export type Engine = 'claude-code' | 'codex';
/** What the installed CLI is known to support; unknown means "not supported", never "assume". */
export interface EngineCaps { codexNetworkOff?: boolean; codexWritableRoots?: boolean }
export interface EngineSettingsCtx { root: string; network: 'allow' | 'deny'; bypassOptIn: boolean; /** Extra folders the agent may write: the temp dir, for example. */ extraRoots?: string[]; caps?: EngineCaps }
export interface EngineSettingsResult { argv: string[]; appServer?: Record<string, unknown>; notes: string[] }
const MODES: readonly PolicyMode[] = ['ask', 'accept-edits', 'plan', 'auto-low-risk', 'bypass'];
const CLAUDE: Record<PolicyMode, string> = { ask: 'default', 'accept-edits': 'acceptEdits', plan: 'plan', 'auto-low-risk': 'default', bypass: 'bypassPermissions' };
const CODEX: Record<PolicyMode, { sandbox: string; approval: string; policy: string; ap: string }> = {
  ask: { sandbox: 'workspace-write', approval: 'untrusted', policy: 'workspaceWrite', ap: 'untrusted' },
  'accept-edits': { sandbox: 'workspace-write', approval: 'on-request', policy: 'workspaceWrite', ap: 'on-request' },
  plan: { sandbox: 'read-only', approval: 'untrusted', policy: 'readOnly', ap: 'untrusted' },
  'auto-low-risk': { sandbox: 'workspace-write', approval: 'untrusted', policy: 'workspaceWrite', ap: 'untrusted' },
  bypass: { sandbox: 'danger-full-access', approval: 'never', policy: 'dangerFullAccess', ap: 'never' },
};
/** Never throws; an unknown engine or mode gets the safest (`ask`) settings and a note. A CLI flag the CLI lacks is left out and a `provider_capability_missing` note says so. */
export function engineSettings(mode: PolicyMode, engine: Engine, ctx: EngineSettingsCtx): EngineSettingsResult {
  const notes: string[] = []; let m: PolicyMode = mode;
  if (!MODES.includes(mode)) { m = 'ask'; notes.push('unknown_mode_used_ask'); }
  if (m === 'bypass' && !ctx.bypassOptIn) { m = 'ask'; notes.push('bypass_requires_opt_in'); }
  if (m === 'auto-low-risk') notes.push('auto_low_risk_uses_allowed_tools');
  if (engine === 'claude-code') {
    if (ctx.network === 'deny') notes.push('provider_capability_missing: claude-code has no network switch; network:deny is not enforced');
    return { argv: ['--permission-mode', CLAUDE[m]], notes };
  }
  if (engine !== 'codex') return { argv: [], notes: [...notes, 'unknown_engine'] };
  const c = CODEX[m]; const argv = ['--sandbox', c.sandbox, '--ask-for-approval', c.approval];
  const caps = ctx.caps ?? {}; const writable = c.sandbox === 'workspace-write';
  const roots = [ctx.root, ...(ctx.extraRoots ?? [])];
  if (writable && ctx.extraRoots?.length) { if (caps.codexWritableRoots) argv.push('-c', `sandbox_workspace_write.writable_roots=${JSON.stringify(ctx.extraRoots)}`); else notes.push('provider_capability_missing: extra writable roots are not enforced'); }
  if (ctx.network === 'deny') { if (writable && caps.codexNetworkOff) argv.push('-c', 'sandbox_workspace_write.network_access=false'); else if (c.sandbox === 'read-only') { /* read-only already has no network */ } else notes.push('provider_capability_missing: network:deny is not enforced'); }
  const sandboxPolicy: Record<string, unknown> = { type: c.policy }; if (writable) { sandboxPolicy.writableRoots = roots; sandboxPolicy.networkAccess = ctx.network === 'allow'; }
  return { argv, appServer: { approvalPolicy: c.ap, sandboxPolicy }, notes };
}

export interface SandboxSettings { writeRoots: string[]; network: 'allow' | 'deny'; protected: string[] }
/** What the agent may write, shown in the UI and passed on as native options. Nothing is enforced here. */
export function sandboxSettings(o: { root: string; tmp?: string; extraRoots?: string[]; network?: 'allow' | 'deny'; platform?: 'posix' | 'win32' }): SandboxSettings {
  const a = o.platform === 'win32' ? win32 : posix; const seen = new Set<string>(); const writeRoots: string[] = [];
  for (const r of [o.root, o.tmp, ...(o.extraRoots ?? [])]) { if (!r) continue; const n = a.resolve(r); if (!seen.has(n)) { seen.add(n); writeRoots.push(n); } }
  return { writeRoots, network: o.network ?? 'allow', protected: [...PROTECTED_PATHS] };
}
