/** Test-time guards: no real network, and no console output from library code unless a test allows it. Installed by `setup.ts` for every test file. */
import dns from 'node:dns';
import net from 'node:net';
import tls from 'node:tls';

export const NETWORK_BLOCKED = 'network access blocked in tests';
const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost', '0.0.0.0', '::', '']);
export const isLoopback = (host: unknown): boolean => { const h = String(host ?? '').replace(/^\[|\]$/g, '').toLowerCase(); return LOOPBACK.has(h) || /^127(\.\d{1,3}){3}$/.test(h) || h === '::ffff:127.0.0.1' || h.endsWith('.localhost'); };
const hostOf = (args: unknown[]): unknown => { const a = args[0]; if (a && typeof a === 'object') return (a as { host?: string; hostname?: string; path?: string }).path ? '' : (a as { host?: string; hostname?: string }).host ?? (a as { hostname?: string }).hostname ?? 'localhost'; return typeof args[1] === 'string' ? args[1] : typeof a === 'number' || (typeof a === 'string' && /^\d+$/.test(a)) ? 'localhost' : ''; };

let installed = false; let current = '';
export const setCurrentTest = (name: string): void => { current = name; };
export function installNetworkGuard(): void {
  if (installed) return; installed = true; const block = (host: unknown) => new Error(`${NETWORK_BLOCKED}: connection to ${String(host)}${current ? ` (test: ${current})` : ''}`);
  const realConnect = net.Socket.prototype.connect as (...a: unknown[]) => net.Socket;
  net.Socket.prototype.connect = function (this: net.Socket, ...args: unknown[]) { const host = hostOf(args); if (!isLoopback(host)) { const e = block(host); process.nextTick(() => this.destroy(e)); return this; } return realConnect.apply(this, args); } as typeof net.Socket.prototype.connect;
  const realTls = tls.connect as (...a: unknown[]) => tls.TLSSocket; (tls as { connect: unknown }).connect = (...args: unknown[]) => { const o = args[0] as { host?: string } | number; const host = typeof o === 'object' ? o.host ?? 'localhost' : args[1] ?? 'localhost'; if (!isLoopback(host)) throw block(host); return realTls(...args); };
  const realLookup = dns.lookup as (...a: unknown[]) => unknown; (dns as { lookup: unknown }).lookup = (host: string, ...rest: unknown[]) => { if (isLoopback(host)) return realLookup(host, ...rest); const cb = rest.find((x) => typeof x === 'function') as ((e: Error) => void) | undefined; const e = block(host); if (cb) { process.nextTick(cb, e); return {}; } throw e; };
  for (const k of ['resolve', 'resolve4', 'resolve6'] as const) { (dns as unknown as Record<string, unknown>)[k] = (host: string, ...rest: unknown[]) => { const cb = rest.find((x) => typeof x === 'function') as ((e: Error) => void) | undefined; const e = block(host); if (cb) { process.nextTick(cb, e); return; } throw e; }; }
}

const LEVELS = ['log', 'info', 'warn', 'error'] as const; type Level = (typeof LEVELS)[number];
let allowed = false; const originals = {} as Record<Level, (...a: unknown[]) => void>;
export function installConsoleGuard(): void {
  for (const l of LEVELS) { if (originals[l]) continue; originals[l] = console[l].bind(console); console[l] = (...a: unknown[]) => { if (allowed) return originals[l](...a); throw new Error(`console.${l} was called from library code during a test (allow it with allowConsole()): ${a.map((x) => String(x)).join(' ').slice(0, 200)}`); }; }
}
/** Lets console output through for the rest of the current test file or until `fn` returns. */
export function allowConsole<T>(fn?: () => T): T | void { if (!fn) { allowed = true; return; } const was = allowed; allowed = true; try { return fn(); } finally { allowed = was; } }
export const resetConsoleGuard = (): void => { allowed = false; };
