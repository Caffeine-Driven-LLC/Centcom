/** Package manifest checks: no install scripts, exact versions only. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { result, unavailable, type CheckResult, type Finding } from './types.js';
export interface Manifest { path: string; json: Record<string, unknown> }
const SCRIPTS = ['install', 'preinstall', 'postinstall', 'prepare', 'preprepare', 'postprepare'];
export function checkInstallScripts(ms: Manifest[]): CheckResult {
  const f: Finding[] = []; for (const m of ms) { const s = (m.json.scripts ?? {}) as Record<string, string>; for (const k of SCRIPTS) if (k in s) f.push({ severity: 'high', location: m.path, message: `declares a "${k}" script` }); } return result('install-scripts', f);
}
const EXACT = /^(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?|workspace:\*|workspace:[\^~]?\d[\w.-]*)$/;
export function checkPinning(ms: Manifest[]): CheckResult {
  const f: Finding[] = [];
  for (const m of ms) for (const sect of ['dependencies', 'devDependencies', 'optionalDependencies']) for (const [name, v] of Object.entries((m.json[sect] ?? {}) as Record<string, string>)) {
    if (EXACT.test(v) || v.startsWith('npm:') && EXACT.test(v.slice(v.lastIndexOf('@') + 1))) continue; f.push({ severity: 'high', location: m.path, message: `${name}@${v} is not an exact version` });
  }
  return result('pinning', f);
}
export function loadManifests(root: string, files: string[]): Manifest[] { return files.filter((x) => x === 'package.json' || /^(apps|packages)\/[^/]+\/package\.json$/.test(x)).map((p) => ({ path: p, json: JSON.parse(readFileSync(join(root, p), 'utf8')) as Record<string, unknown> })); }
export function checkPackages(root: string, files: string[]): CheckResult[] { try { const ms = loadManifests(root, files); return [checkInstallScripts(ms), checkPinning(ms)]; } catch (e) { return [unavailable('install-scripts', (e as Error).message), unavailable('pinning', (e as Error).message)]; } }
