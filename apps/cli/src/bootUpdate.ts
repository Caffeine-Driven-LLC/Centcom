/** Each time Centcom starts it looks, in the background, for a newer release on your channel and brings it in, so the next start is the latest.
 *  - a standalone install replaces its own program with the verified download (the old one is kept for `centcom update --rollback`);
 *  - an npm or Homebrew install runs the package manager's own update command;
 *  - a source checkout is only told that a newer version exists.
 *  Nothing blocks the start: the check gives up after 5 s, the download after 2 minutes, and a failure only ever shows a note. */
import { spawn } from 'node:child_process';
import { ManagedInstallError, updateCommand, type CheckResult, type InstallMethod, type StagedUpdate } from '@centcom/net';

export interface BootUpdateClient {
  method: InstallMethod;
  check(o?: { signal?: AbortSignal }): Promise<CheckResult>;
  download(o?: { signal?: AbortSignal }): Promise<StagedUpdate>;
  verify(s: StagedUpdate): Promise<void>;
  apply(s: StagedUpdate): Promise<{ restartRequired: boolean; previous: string }>;
}
export interface BootUpdateDeps {
  client: BootUpdateClient; env: Record<string, string | undefined>; version: string;
  /** `update.check`: look for updates at all. */ check: boolean;
  /** `update.auto`: bring a newer version in without asking; off only says that one exists. */ auto: boolean;
  say(level: 'info' | 'warn', text: string, detail?: string): void;
  /** Runs a package manager command; true when it succeeded. */ run?(argv: string[], signal: AbortSignal): Promise<boolean>;
  checkMs?: number; installMs?: number;
}
export type BootUpdateResult = 'off' | 'current' | 'available' | 'updated' | 'failed';

export const CHECK_MS = 5000; export const INSTALL_MS = 120_000;
export const packageManagerArgv = (m: InstallMethod): string[] | undefined => (m === 'homebrew' ? ['brew', 'upgrade', 'centcom'] : m === 'npm' ? ['npm', 'install', '--global', 'centcom@latest'] : undefined);

/** Is the check allowed at all? Not when switched off, not under CI, and not when the user asked for no update check. */
export function updatesWanted(o: { check: boolean; env: Record<string, string | undefined> }): boolean {
  const e = o.env; return o.check && !e.CI && !/^(1|true)$/i.test(e.CENTCOM_NO_UPDATE_CHECK ?? '');
}

export async function bootUpdate(d: BootUpdateDeps): Promise<BootUpdateResult> {
  if (!updatesWanted(d)) return 'off';
  const within = <T>(ms: number, f: (s: AbortSignal) => Promise<T>) => { const ac = new AbortController(); const t = setTimeout(() => ac.abort(), ms); t.unref(); return f(ac.signal).finally(() => clearTimeout(t)); };
  let c: CheckResult;
  try { c = await within(d.checkMs ?? CHECK_MS, (signal) => d.client.check({ signal })); } catch { return 'failed'; } // offline or slow: the next start tries again
  if (!c.available || !c.version) { if (c.required) d.say('warn', 'This version of Centcom is too old for the service, and no newer one is published on your channel yet.'); return 'current'; }
  const v = c.version; const how = updateCommand(d.client.method); const notes = c.notesUrl ? ` Notes: ${c.notesUrl}` : '';
  const offer = (why?: string) => { d.say('info', `Centcom ${v} is available.`, `${how ? `Update with: ${how}` : d.client.method === 'sea' ? 'Update with: centcom update' : 'You are running from a source checkout: pull the latest and rebuild.'}${why ? ` (${why})` : ''}${notes}`); return 'available' as const; };
  if (!d.auto) return offer();
  const ms = d.installMs ?? INSTALL_MS;
  try {
    const argv = packageManagerArgv(d.client.method);
    if (argv) { const ok = await within(ms, (s) => (d.run ?? runCommand)(argv, s)); if (!ok) return offer('the automatic update did not work'); }
    else if (d.client.method === 'sea') { await within(ms, async (signal) => { const s = await d.client.download({ signal }); await d.client.verify(s); await d.client.apply(s); }); }
    else return offer();
  } catch (e) { return e instanceof ManagedInstallError ? offer() : offer('the automatic update did not work, and nothing was changed'); }
  d.say('info', `Centcom updated to ${v}.`, `It is used the next time you start it. To go back: centcom update --rollback.${notes}`);
  return 'updated';
}

/** Runs a command with no terminal attached; resolves true on exit code 0, and stops it when the signal fires. */
export function runCommand(argv: string[], signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    try { const p = spawn(argv[0]!, argv.slice(1), { stdio: 'ignore', signal }); p.on('error', () => resolve(false)); p.on('exit', (code) => resolve(code === 0)); } catch { resolve(false); }
  });
}
