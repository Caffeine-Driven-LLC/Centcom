/** What the account commands share: their dependencies, a small flag parser, and one mapping from errors to a message and an exit code.
 *  Must not: print a stack trace, a response body or any secret; read process globals (everything comes in through AccountDeps). */
import { ApiError, AuthExpiredError, AuthRequiredError, CentcomError, KeychainUnavailableError, TransportError, userMessage, type AuthClock, type AuthDeviceKeyProvider, type HttpClient, type TokenManager } from '@centcom/net';
import { EXIT, MSG } from './messages.js';

export interface AccountIO { out(line: string): void; err(line: string): void; /** stdin and stdout are a terminal: prompts are allowed */ isTTY: boolean }

/** Everything the account commands touch. Tests pass fakes; cli.ts passes the real things. */
export interface AccountDeps {
  /** the HTTP client with the TokenManager as its identity */
  http: HttpClient;
  auth: TokenManager;
  keys: AuthDeviceKeyProvider;
  openBrowser(url: string): Promise<boolean>;
  io: AccountIO;
  hostname(): string;
  /** the configured API base URL; an http loopback one is the only non-https sign-in page that may be opened */
  baseUrl?: string;
  /** device-flow polling clock (default: real time) */
  clock?: AuthClock;
  /** aborted on Ctrl-C */
  signal?: AbortSignal;
  /** one line from stdin (for --api-key-stdin), or null at end of input */
  readLine?(): Promise<string | null>;
  /** a yes/no question on the terminal; only called when io.isTTY */
  confirm?(question: string): Promise<boolean>;
}

/** The smallest command router: `centcom <name> ...argv` runs the registered function and exits with what it returns. */
export interface CommandBuilder { command(name: string, run: (argv: string[]) => Promise<number>): void }

export type Flags = { bool: Set<string>; values: Map<string, string>; positional: string[] };
/** Parse `--flag` and `--opt value` / `--opt=value`. Unknown flags are an error message (returned), never thrown. */
export function parseFlags(argv: string[], spec: { bool?: string[]; value?: string[] }): Flags | { error: string } {
  const bool = new Set<string>(); const values = new Map<string, string>(); const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith('--')) { positional.push(a); continue; }
    const eq = a.indexOf('='); const name = eq > 0 ? a.slice(0, eq) : a;
    if (spec.bool?.includes(name) && eq < 0) { bool.add(name); continue; }
    if (spec.value?.includes(name)) { const v = eq > 0 ? a.slice(eq + 1) : argv[++i]; if (v === undefined || v === '') return { error: MSG.usage.missingValue(name) }; values.set(name, v); continue; }
    return { error: MSG.usage.unknownFlag(name) };
  }
  return { bool, values, positional };
}

/** Text from the server (names, platforms) without terminal control characters. */
export const clean = (s: unknown, max = 80): string => String(s ?? '').replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, '').slice(0, max);

const ENDED = new Set(['token_invalid', 'token_revoked', 'device_revoked', 'refresh_reuse_detected', 'unauthorized']);

/** Say what went wrong (one or two lines on stderr) and choose the exit code: 2 when a sign-in is needed, else 1. */
export async function reportError(e: unknown, d: AccountDeps): Promise<number> {
  const err = d.io.err;
  if (e instanceof AuthRequiredError) { err(e.reason ? MSG.errors.sessionEnded : MSG.errors.notSignedIn); return EXIT.authRequired; }
  if (e instanceof AuthExpiredError) { err(MSG.errors.sessionEnded); return EXIT.authRequired; }
  if (e instanceof ApiError && e.status === 401 && ENDED.has(e.rawCode)) {
    try { await d.auth.clearLocal(); } catch { /* the keychain is down: memory is cleared anyway */ }
    const m = userMessage(e); err(MSG.errors.line(m.title + '.', m.hint)); return EXIT.authRequired;
  }
  if (e instanceof KeychainUnavailableError) { err(MSG.errors.keychain); err(e.remediation); return EXIT.failure; }
  if (e instanceof TransportError && e.transport !== 'bad_response') { err(e.transport === 'aborted' ? MSG.login.cancelled : MSG.errors.offline); return EXIT.failure; }
  if (e instanceof CentcomError) { const m = userMessage(e); err(MSG.errors.line(m.title + '.', m.hint, m.ref)); return EXIT.failure; }
  err(MSG.errors.unexpected); return EXIT.failure;
}
