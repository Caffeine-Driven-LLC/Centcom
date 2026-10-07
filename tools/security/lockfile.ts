/** Lockfile integrity: every registry package has an integrity hash, nothing comes from a git URL or a bare tarball, and nothing points at plain http. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import YAML from 'yaml';
import { result, unavailable, type CheckResult, type Finding } from './types.js';
export interface Lock { importers: Record<string, { dependencies?: Record<string, { specifier: string; version: string }>; devDependencies?: Record<string, { specifier: string; version: string }> }>; packages: Record<string, { resolution?: { integrity?: string; tarball?: string; repo?: string; type?: string; directory?: string } }>; snapshots: Record<string, { dependencies?: Record<string, string>; optionalDependencies?: Record<string, string> }> }
/** pnpm writes two YAML documents (the package manager's own, then the project's); the last one is the project's. */
export function parseLock(text: string): Lock { const docs = YAML.parseAllDocuments(text); const last = docs[docs.length - 1]; if (!last || last.errors.length) throw new Error('pnpm-lock.yaml could not be read'); const l = last.toJS() as Partial<Lock>; return { importers: l.importers ?? {}, packages: l.packages ?? {}, snapshots: l.snapshots ?? {} }; }
export const readLock = (root: string): Lock => parseLock(readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8'));
export function checkLockfile(lock: Lock): CheckResult {
  const f: Finding[] = []; const entries = Object.entries(lock.packages);
  if (entries.length === 0) f.push({ severity: 'high', location: 'pnpm-lock.yaml', message: 'the lockfile lists no packages' });
  for (const [k, p] of entries) { const r = p.resolution ?? {}; if (r.tarball?.startsWith('http://')) f.push({ severity: 'high', location: k, message: 'resolved over plain http' }); if (r.repo || r.type === 'git') f.push({ severity: 'high', location: k, message: 'resolved from a git repository' }); else if (r.tarball && !r.integrity) f.push({ severity: 'high', location: k, message: 'a tarball without an integrity hash' }); else if (!r.integrity && !r.directory) f.push({ severity: 'high', location: k, message: 'no integrity hash' }); else if (r.integrity && !/^sha(256|384|512)-[A-Za-z0-9+/=]+$/.test(r.integrity)) f.push({ severity: 'high', location: k, message: 'malformed integrity hash' }); }
  return result('lockfile', f);
}
export function checkLockfileAt(root: string): CheckResult { try { return checkLockfile(readLock(root)); } catch (e) { return unavailable('lockfile', (e as Error).message); } }
