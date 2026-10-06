/** `centcom provider status|login|logout|doctor`. Everything it touches is injected so tests never start a process or read a terminal. */
import { providerDoctorChecks, loginHandoff, logoutHandoff, providerMessage, redactProviderText, DETECTED_ENGINES, type DetectedEngine, type HandoffDeps, type DoctorCtx } from '@centcom/agent';
import { hasWarning, nextStepLine, policyJson, policyLines, statusJson, statusLine } from './status.js';

export interface ProviderIO extends Omit<HandoffDeps, 'say'> { out(line: string): void; err(line: string): void; os?: NodeJS.Platform; now(): number; logDir?: string; policyCheckedAt?: string }
const ALIAS: Record<string, DetectedEngine> = { claude: 'claude-code', 'claude-code': 'claude-code', codex: 'codex' };
export const PROVIDER_HELP = `centcom provider status [claude|codex] [--json] [--refresh] [--policy]
centcom provider login <claude|codex> [--console]
centcom provider logout <claude|codex> [--yes]
centcom provider doctor [--json]`;

export async function runProvider(argv: string[], io: ProviderIO): Promise<number> {
  const [sub, ...rest] = argv; const flags = new Set(rest.filter((a) => a.startsWith('--'))); const pos = rest.filter((a) => !a.startsWith('--'));
  const named = pos[0] ? ALIAS[pos[0]] : undefined; if (pos[0] && !named) { io.err(`Unknown provider "${redactProviderText(pos[0]).slice(0, 40)}". Use claude or codex.`); return 2; }
  const ctx: DoctorCtx = { detector: io.detector, now: io.now, ...(io.os ? { os: io.os } : {}), ...(io.logDir ? { logDir: io.logDir } : {}), ...(io.policyCheckedAt ? { policyCheckedAt: io.policyCheckedAt } : {}) };
  switch (sub) {
    case 'status': {
      const list = named ? [await io.detector.detect(named, { refresh: flags.has('--refresh') })] : await io.detector.detectAll({ refresh: flags.has('--refresh') });
      if (flags.has('--json')) io.out(statusJson(list, flags.has('--policy') ? policyJson(ctx) : undefined));
      else { for (const s of list) { io.out(redactProviderText(statusLine(s))); const n = nextStepLine(s, io.os); if (n) io.out(n); } if (flags.has('--policy')) for (const l of policyLines(ctx)) io.out(l); }
      if (named && !list[0]!.installed) return 2; return list.some(hasWarning) ? 1 : 0;
    }
    case 'login': case 'logout': {
      if (!named) { io.err(`Usage: centcom provider ${sub} <claude|codex>`); return 2; }
      const r = sub === 'login' ? await loginHandoff(named, { ...io, say: io.out }, { console: flags.has('--console') }) : await logoutHandoff(named, { ...io, say: io.out }, { yes: flags.has('--yes') });
      if (r.refused) {
        const why = r.refused.reason; if (why === 'not_installed') { const m = providerMessage('provider_not_installed', { engine: named, os: io.os }); io.err(`${m.title}. ${m.next_step}`); return 2; }
        if (why === 'declined') { io.out('Nothing changed.'); return 1; }
        io.err(why === 'no_tty' ? `This needs an interactive terminal. Run it yourself: ${r.refused.manual}` : `Not available in this version. ${r.refused.manual}`); return 1;
      }
      io.out(redactProviderText(statusLine(r.status))); if (r.exit_code === 130) return 130; return r.exit_code === 0 && !r.still_signed_out && (sub === 'logout' || r.status.signed_in === 'yes') ? 0 : 1;
    }
    case 'doctor': {
      const results = []; for (const c of providerDoctorChecks) { const r = await c.run(ctx).catch((e) => ({ status: 'fail' as const, message: `the check itself failed (${(e as Error).name})` })); results.push({ id: c.id, ...r }); }
      if (flags.has('--json')) io.out(JSON.stringify({ schema_version: 1, checks: results.map((r) => ({ ...r, message: redactProviderText(r.message) })) }, null, 2));
      else for (const r of results) { io.out(`${{ ok: 'ok  ', warn: 'warn', fail: 'FAIL', skip: 'skip' }[r.status]}  ${r.id}  ${redactProviderText(r.message)}`); if ('next_step' in r && r.next_step && r.status !== 'ok') io.out(`      ${r.next_step}`); }
      return results.some((r) => r.status === 'warn' || r.status === 'fail') ? 1 : 0;
    }
    default: io.err(PROVIDER_HELP); return sub ? 2 : 0;
  }
}
export const PROVIDER_ENGINES = DETECTED_ENGINES;
