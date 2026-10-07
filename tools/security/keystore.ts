/** After a login, nothing secret may sit in the user's config or state folders: tokens and keys live in the OS keychain. */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { result, type CheckResult, type Finding } from './types.js';
/** The marker as it appears inside base64 text at each of the three byte alignments (edges that depend on neighbouring bytes are cut off). */
const b64Forms = (m: string): string[] => [0, 1, 2].map((off) => { const e = Buffer.from('\0'.repeat(off) + m).toString('base64').replace(/=+$/, ''); return e.slice([0, 2, 3][off]!, Math.max(e.length - 2, 6)); });
export function scanDirsForMarkers(dirs: string[], markers: string[]): Finding[] {
  const out: Finding[] = []; const needles = markers.filter((m) => m.length >= 8);
  const walk = (d: string): void => { if (!existsSync(d)) return; for (const n of readdirSync(d)) { const p = join(d, n); const s = statSync(p); if (s.isDirectory()) { walk(p); continue; } if (s.size > 8 * 1024 * 1024) continue; const b = readFileSync(p); const text = b.toString('latin1'); for (const m of needles) if (text.includes(m) || b64Forms(m).some((x) => text.includes(x))) out.push({ severity: 'high', location: p, message: 'contains a secret marker (token or key stored outside the keychain)' }); } };
  for (const d of dirs) walk(d); return out;
}
export const checkKeystore = (dirs: string[], markers: string[]): CheckResult => result('keystore', scanDirsForMarkers(dirs, markers));
