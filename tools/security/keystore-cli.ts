/**
 * `tsx tools/security/keystore-cli.ts --keychain <folder> <folder to scan>...`
 * After a real sign-in with `CENTCOM_KEYCHAIN=file:<folder>`, every secret in the keychain folder (tokens, keys: the long strings in its files)
 * must be absent, in plain text or base64, from every other folder the app writes to (config, state, data, cache, logs, crash reports).
 * Exit 0: clean. Exit 1: a secret was found (the file is named, never the value). Exit 2: nothing to compare with, or bad arguments.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { scanDirsForMarkers } from './keystore.js';

const MIN = 16;
/** A prefixed id (`dev_01J...`) names a thing; it is not a secret and the logs may carry it. */
const ID = /^[a-z]{2,4}_[0-9A-HJKMNP-TV-Z]{26}$/;
/** The strings of a keychain entry worth looking for: the long string values of a JSON document, or the whole text when it is not JSON. */
export function secretsIn(text: string): string[] {
  const out: string[] = []; const t = text.trim();
  try { const walk = (v: unknown): void => { if (typeof v === 'string') { if (v.length >= MIN && !ID.test(v)) out.push(v); } else if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') Object.values(v).forEach(walk); }; walk(JSON.parse(t)); if (out.length) return out; } catch { /* not JSON */ }
  return t.length >= MIN && !ID.test(t) ? [t] : [];
}
export function markersFrom(keychain: string): string[] { return existsSync(keychain) ? readdirSync(keychain).flatMap((n) => secretsIn(readFileSync(join(keychain, n), 'utf8'))) : []; }

export function main(argv: string[], out: (s: string) => void = console.log): number {
  const i = argv.indexOf('--keychain'); const keychain = i >= 0 ? argv[i + 1] : undefined; const dirs = argv.filter((a, k) => !a.startsWith('--') && k !== i + 1);
  if (!keychain || !dirs.length) { out('usage: keystore-cli.ts --keychain <folder> <folder to scan>...'); return 2; }
  const markers = markersFrom(resolve(keychain)); if (!markers.length) { out(`nothing in ${keychain} to look for: sign in first`); return 2; }
  const found = scanDirsForMarkers(dirs.map((d) => resolve(d)).filter((d) => d !== resolve(keychain)), markers);
  out(`looked for ${markers.length} secret(s) from the keychain in ${dirs.length} folder(s): ${found.length ? found.length + ' found' : 'none found'}`);
  for (const f of found) out(`  ${f.location}: ${f.message}`);
  return found.length ? 1 : 0;
}
if (process.argv[1] && /keystore-cli\.(ts|js)$/.test(process.argv[1])) process.exit(main(process.argv.slice(2)));
