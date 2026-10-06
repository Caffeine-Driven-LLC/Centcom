/** The real-world wiring of `centcom login|logout|whoami|devices`: config, OS keychain, network, terminal, Ctrl-C. The logic lives in the files next to this one and is tested with fakes.
 *  `CENTCOM_KEYCHAIN=memory` keeps every secret in this process only (nothing is stored anywhere; each run starts signed out). It exists for tests and throwaway machines. */
import { hostname, homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { defaultDeps, loadConfig, stateDir } from '@centcom/config';
import { CryptoError, DeviceKeyStore, TokenManager, createAppLogger, createHttpClient, createKeychainApiKeyStore, createKeychainTokenStore, defaultUserAgent, initCrypto, memoryKeychain, osAuthKeychain, osKeychain, realAuthClock, type Keychain } from '@centcom/net';
import { createBrowserOpener } from './browser.js';
import { createCommandRegistry, registerAccountCommands, type AccountDeps } from './index.js';

const MAX_LINE = 4096; const LINE_TIMEOUT_MS = 60_000;

/** One line from stdin, at most 4 KiB, within 60 s; null at end of input. */
function readStdinLine(): Promise<string | null> {
  return new Promise((resolve) => {
    let buf = ''; const stdin = process.stdin;
    const done = (v: string | null) => { clearTimeout(t); stdin.off('data', onData); stdin.off('end', onEnd); stdin.pause(); resolve(v); };
    const onData = (c: Buffer) => { buf += c.toString('utf8'); const nl = buf.indexOf('\n'); if (nl >= 0) done(buf.slice(0, nl)); else if (buf.length > MAX_LINE) done(buf.slice(0, MAX_LINE)); };
    const onEnd = () => done(buf.length ? buf : null);
    const t = setTimeout(() => done(buf.length ? buf : null), LINE_TIMEOUT_MS);
    stdin.on('data', onData); stdin.once('end', onEnd); stdin.resume();
  });
}

/** Device keys go to the OS keychain; if it is unavailable they stay in memory for this run (like the sign-in itself). */
function keysKeychain(primary: Keychain): Keychain {
  const mem = memoryKeychain(); let down = false;
  const run = async <T>(f: (k: Keychain) => Promise<T>): Promise<T> => { if (down) return f(mem); try { return await f(primary); } catch (e) { if (!(e instanceof CryptoError)) throw e; down = true; return f(mem); } };
  return { get: (a) => run((k) => k.get(a)), set: (a, v) => run((k) => k.set(a, v)), delete: (a) => run((k) => k.delete(a)) };
}

/** Run one account command with real dependencies. Returns the exit code. */
export async function runAccountCli(name: string, argv: string[], o: { version: string }): Promise<number> {
  const deps0 = defaultDeps(); const cfg = await loadConfig(deps0); const baseUrl = cfg.api.base_url; const apiHost = new URL(baseUrl).host;
  const memoryOnly = process.env.CENTCOM_KEYCHAIN === 'memory';
  const authKc = memoryOnly ? memoryKeychain() : osAuthKeychain(); const keyKc = memoryOnly ? memoryKeychain() : keysKeychain(osKeychain());
  const { logger } = createAppLogger({ level: process.argv.includes('--debug') ? 'debug' : cfg.log.level, maxBytes: cfg.log.max_file_bytes, maxFiles: cfg.log.max_files, stateDir: stateDir(deps0), home: homedir() });
  const http = createHttpClient({ getAccessToken: async () => undefined, baseUrl, userAgent: defaultUserAgent(o.version), logger, timeoutMs: cfg.net.timeout_ms, maxAttempts: cfg.net.max_attempts });
  const store = createKeychainTokenStore(apiHost, { keychain: authKc });
  const auth = new TokenManager({ http, store, apiKeys: createKeychainApiKeyStore(apiHost, { keychain: authKc }), clock: realAuthClock, lockDir: join(stateDir(deps0), 'locks'), apiHost, logger });
  let keys: DeviceKeyStore | undefined;
  const ac = new AbortController(); const onSigint = () => ac.abort(); process.on('SIGINT', onSigint);
  const deps: AccountDeps = {
    http: http.withAuthProvider(auth.authProvider()), auth, baseUrl, clock: realAuthClock, signal: ac.signal, hostname: () => hostname(),
    keys: Object.assign({ getOrCreatePublicKeys: async () => { await initCrypto(); keys ??= new DeviceKeyStore(keyKc, 'pending'); return keys.getOrCreatePublicKeys(); } }, { rebindDeviceId: async (id: string) => { await keys?.rebindDeviceId(id); } }), /* a new login registers this device's keys, then they move to its dev_ id */
    openBrowser: createBrowserOpener({ devBaseUrl: baseUrl }),
    io: { out: (l) => process.stdout.write(l + '\n'), err: (l) => process.stderr.write(l + '\n'), isTTY: !!process.stdin.isTTY && !!process.stdout.isTTY },
    readLine: readStdinLine,
    confirm: async (q) => { const rl = createInterface({ input: process.stdin, output: process.stdout }); try { return /^y(es)?$/i.test((await rl.question(`${q} [y/N] `)).trim()); } finally { rl.close(); } },
  };
  const reg = createCommandRegistry(); registerAccountCommands(reg, deps);
  try { return (await reg.run(name, argv)) ?? 1; } finally { process.off('SIGINT', onSigint); await logger.flush(); }
}
