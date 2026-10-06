/** Sign-in and sign-out are the vendor's own commands, run in the user's own terminal with its streams handed over. Centcom does not capture, drive or read them. */
import type { ProviderStatus, DetectedEngine, ProviderDetector } from './detect.js';
import { manualLogin, manualLogout } from './install-hints.js';

export interface ChildLike { once(ev: 'close', cb: (code: number | null, signal: string | null) => void): unknown; once(ev: 'error', cb: (e: Error) => void): unknown }
export type SpawnFn = (file: string, args: string[], o: { stdio: 'inherit'; shell: false }) => ChildLike;
export interface HandoffDeps { spawn: SpawnFn; detector: ProviderDetector; isTTY: boolean; say(line: string): void; confirm?(question: string): Promise<boolean> }
export interface HandoffResult { exit_code: number | null; status: ProviderStatus; /** Set when nothing was started, with the reason and the command to run by hand. */ refused?: { reason: 'not_installed' | 'no_tty' | 'unsupported' | 'declined'; manual: string }; still_signed_out?: boolean }

function wait(c: ChildLike): Promise<number | null> { return new Promise((res) => { c.once('close', (code, sig) => res(sig === 'SIGINT' ? 130 : code)); c.once('error', () => res(null)); }); }

export async function loginHandoff(id: DetectedEngine, d: HandoffDeps, o: { console?: boolean } = {}): Promise<HandoffResult> {
  const status = await d.detector.detect(id); const manual = manualLogin(id);
  if (!status.installed || !status.path) return { exit_code: null, status, refused: { reason: 'not_installed', manual } };
  if (!d.isTTY) return { exit_code: null, status, refused: { reason: 'no_tty', manual } };
  let args: string[];
  if (id === 'codex') args = ['login']; else if (status.auth_command) args = ['auth', 'login', ...(o.console ? ['--console'] : [])]; else { args = []; d.say('Claude Code will open. Type /login there to sign in.'); }
  const code = await wait(d.spawn(status.path, args, { stdio: 'inherit', shell: false }));
  const after = await d.detector.detect(id, { refresh: true }); const still = after.signed_in !== 'yes';
  if (code === 0 && still) d.say(`The tool finished, but it still reports no sign-in. Try \`${manual}\` yourself.`);
  return { exit_code: code, status: after, ...(code === 0 && still ? { still_signed_out: true } : {}) };
}

export async function logoutHandoff(id: DetectedEngine, d: HandoffDeps, o: { yes?: boolean } = {}): Promise<HandoffResult> {
  const status = await d.detector.detect(id); const manual = manualLogout(id);
  if (!status.installed || !status.path) return { exit_code: null, status, refused: { reason: 'not_installed', manual } };
  if (id === 'claude-code' && !status.auth_command) return { exit_code: null, status, refused: { reason: 'unsupported', manual: 'type /logout inside claude' } };
  if (!o.yes) { if (!d.isTTY || !d.confirm) return { exit_code: null, status, refused: { reason: 'no_tty', manual } }; if (!(await d.confirm(`Sign out of ${id === 'codex' ? 'Codex' : 'Claude Code'}?`))) return { exit_code: null, status, refused: { reason: 'declined', manual } }; }
  const code = await wait(d.spawn(status.path, id === 'codex' ? ['logout'] : ['auth', 'logout'], { stdio: 'inherit', shell: false }));
  return { exit_code: code, status: await d.detector.detect(id, { refresh: true }) };
}
