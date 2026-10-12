/** The OS keychain (via @napi-rs/keyring, loaded only when used), behind a tiny interface tests can fake. Private keys live only here. */
import { CryptoError } from './sodium.js';

export interface Keychain { get(account: string): Promise<string | undefined>; set(account: string, value: string): Promise<void>; delete(account: string): Promise<void> }
export const KEYCHAIN_SERVICE = 'dev.centcom';
export function osKeychain(service = KEYCHAIN_SERVICE): Keychain {
  const entry = async (account: string) => { try { const m = (await import('@napi-rs/keyring')) as { Entry: new (s: string, a: string) => { getPassword(): string | null; setPassword(p: string): void; deletePassword(): boolean } }; return new m.Entry(service, account); } catch { throw new CryptoError('keychain', 'The system keychain is not available.'); } };
  return {
    async get(a) { try { return (await entry(a)).getPassword() ?? undefined; } catch (e) { if (e instanceof CryptoError) throw e; return undefined; } },
    async set(a, v) { try { (await entry(a)).setPassword(v); } catch (e) { if (e instanceof CryptoError) throw e; throw new CryptoError('keychain', 'Could not save to the system keychain.'); } },
    async delete(a) { try { (await entry(a)).deletePassword(); } catch { /* already gone */ } },
  };
}
/** For tests: an in-memory keychain. */
export function memoryKeychain(): Keychain & { entries: Map<string, string> } { const entries = new Map<string, string>(); return { entries, get: async (a) => entries.get(a), set: async (a, v) => { entries.set(a, v); }, delete: async (a) => { entries.delete(a); } }; }

/**
 * DEVELOPMENT AND TESTS ONLY: a keychain in a folder (one 0600 file per entry, the folder 0700), chosen with `CENTCOM_KEYCHAIN=file:<folder>`.
 * It exists so a throwaway home can hold a sign-in across the separate `centcom` runs of a check (a machine without a Secret Service has
 * nowhere else to keep one). Never the default: the contract keeps private keys in the OS keychain.
 */
export function fileKeychain(dir: string): Keychain {
  // The node modules load only when this is used (the browser bundle of apps/web shares this file and never calls it).
  const node = async () => ({ fs: await import('node:fs/promises'), crypto: await import('node:crypto') });
  const file = async (account: string) => { const { crypto } = await node(); return `${dir.replace(/[\\/]+$/, '')}/${crypto.createHash('sha256').update(account).digest('hex')}.secret`; };
  return {
    async get(a) { try { return await (await node()).fs.readFile(await file(a), 'utf8'); } catch { return undefined; } },
    async set(a, v) { const { fs } = await node(); await fs.mkdir(dir, { recursive: true, mode: 0o700 }); await fs.writeFile(await file(a), v, { mode: 0o600 }); },
    async delete(a) { await (await node()).fs.rm(await file(a), { force: true }); },
  };
}
/** The folder named by `CENTCOM_KEYCHAIN=file:<folder>`, if any. */
export function keychainDirFromEnv(env: Record<string, string | undefined> = process.env): string | undefined { const v = env['CENTCOM_KEYCHAIN']; return v !== undefined && v.startsWith('file:') && v.length > 5 ? v.slice(5) : undefined; }
