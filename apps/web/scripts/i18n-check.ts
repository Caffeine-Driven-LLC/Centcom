/** `pnpm --filter @centcom/web i18n:check`: every key used in the shell's code must exist in en.json (an error); keys nobody uses are listed (a warning). */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('../shell/src/', import.meta.url).pathname;
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
export function check(src: string = root): { missing: { key: string; file: string }[]; unused: string[] } {
  const en = JSON.parse(readFileSync(join(src, 'i18n/en.json'), 'utf8')) as Record<string, string>; const used = new Set<string>(); const missing: { key: string; file: string }[] = [];
  const dynamic = [/`state\.\$\{/, /`error\.\$\{/, /error\.status\./, /'nav\.labelKey/];
  for (const f of walk(src).filter((x) => /\.(tsx?|ts)$/.test(x) && !x.includes('/i18n/'))) {
    const s = readFileSync(f, 'utf8');
    for (const m of s.matchAll(/\b(?:t|tp)\(\s*'([a-z0-9_.-]+)'/g)) { used.add(m[1]!); if (!(m[1]! in en)) missing.push({ key: m[1]!, file: f.replace(src, '') }); }
    for (const m of s.matchAll(/labelKey:\s*'([a-z0-9_.-]+)'/g)) { used.add(m[1]!); if (!(m[1]! in en)) missing.push({ key: m[1]!, file: f.replace(src, '') }); }
    for (const d of dynamic) if (d.test(s)) for (const k of Object.keys(en)) if (k.startsWith('state.') || k.startsWith('error.')) used.add(k);
  }
  for (const k of Object.keys(en)) if (k.startsWith('state.') || k.startsWith('error.')) used.add(k); /* these families are looked up by code */
  return { missing, unused: Object.keys(en).filter((k) => !used.has(k)) };
}
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop()!)) { const r = check(); for (const u of r.unused) console.warn(`unused key: ${u}`); for (const m of r.missing) console.error(`missing key ${m.key} (used in ${m.file})`); process.exit(r.missing.length ? 1 : 0); }
