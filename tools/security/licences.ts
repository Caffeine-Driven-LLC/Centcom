/** Licence allow-list. An SPDX expression passes when every AND part has at least one allowed OR alternative; an unknown or missing licence fails closed. */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { result, unavailable, type CheckResult, type Finding } from './types.js';
export interface LicencePolicy { allow: string[]; /** per package, with a reason, for licences outside the list (data and fonts) */ exceptions: { package: string; licence: string; reason: string }[] }
export interface Installed { name: string; version: string; licence: string | undefined }

export function expressionAllowed(expr: string, allow: ReadonlySet<string>): boolean {
  const toks = expr.replace(/[()]/g, ' $& ').split(/\s+/).filter(Boolean); let i = 0;
  const parseOr = (): boolean => { let v = parseAnd(); while (toks[i] === 'OR') { i++; const r = parseAnd(); v = v || r; } return v; };
  const parseAnd = (): boolean => { let v = parseAtom(); while (toks[i] === 'AND') { i++; const r = parseAtom(); v = v && r; } return v; };
  const parseAtom = (): boolean => { const t = toks[i++]; if (t === '(') { const v = parseOr(); if (toks[i] === ')') i++; else return false; return v; } return t !== undefined && !['OR', 'AND', ')', 'WITH'].includes(t) && allow.has(t); };
  try { const v = parseOr(); return v && i === toks.length; } catch { return false; }
}
export function checkLicences(pkgs: Installed[], policy: LicencePolicy): CheckResult {
  const allow = new Set(policy.allow); const f: Finding[] = [];
  for (const p of pkgs) {
    if (!p.licence) { f.push({ severity: 'high', location: `${p.name}@${p.version}`, message: 'no licence declared (unknown licences fail closed)' }); continue; }
    if (expressionAllowed(p.licence, allow)) continue; if (policy.exceptions.some((e) => e.package === p.name && e.licence === p.licence)) continue;
    f.push({ severity: 'high', location: `${p.name}@${p.version}`, message: `licence ${p.licence} is not on the allow-list` });
  }
  return result('licences', f);
}
/** Reads the installed packages from node_modules/.pnpm (needs an install). */
export function readInstalled(root: string): Installed[] {
  const base = join(root, 'node_modules', '.pnpm'); if (!existsSync(base)) throw new Error('node_modules/.pnpm is missing: run pnpm install first'); const seen = new Map<string, Installed>();
  for (const e of readdirSync(base)) {
    const nm = join(base, e, 'node_modules'); if (!existsSync(nm)) continue;
    for (const d of readdirSync(nm)) for (const q of d.startsWith('@') ? readdirSync(join(nm, d)).map((y) => `${d}/${y}`) : [d]) {
      try { const j = JSON.parse(readFileSync(join(nm, q, 'package.json'), 'utf8')) as { name?: string; version?: string; license?: unknown; licenses?: unknown }; if (j.name !== q || !j.version || q.startsWith('@centcom/')) continue;
        const lic = typeof j.license === 'string' ? j.license : (j.license as { type?: string } | undefined)?.type ?? (Array.isArray(j.licenses) ? (j.licenses as { type?: string }[]).map((x) => x.type).filter(Boolean).join(' OR ') || undefined : undefined); seen.set(`${q}@${j.version}`, { name: q, version: j.version, licence: lic }); } catch { /* not a package folder */ }
    }
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}
export function checkInstalledLicences(root: string, policy: LicencePolicy): CheckResult { try { return checkLicences(readInstalled(root), policy); } catch (e) { return unavailable('licences', (e as Error).message); } }
