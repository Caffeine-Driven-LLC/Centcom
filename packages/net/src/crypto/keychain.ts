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
