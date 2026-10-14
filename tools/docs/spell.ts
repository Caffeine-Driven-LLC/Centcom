/** The spell check of the docs (lane C096): a list of known misspellings (tools/docs/spell-list.txt), and a few phrases the docs must never use
 *  because they promise more than the contracts do. Code, inline code and link targets are not checked. It is a list of mistakes, not a dictionary,
 *  so it needs no download and cannot flag a product word. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export interface SpellProblem { where: string; what: string }
const LIST = fileURLToPath(new URL('./spell-list.txt', import.meta.url));
export function loadList(text: string = readFileSync(LIST, 'utf8')): Map<string, string> {
  const m = new Map<string, string>();
  for (const raw of text.split('\n')) { const l = raw.trim(); if (!l || l.startsWith('#')) continue; const [bad, good] = l.split('->'); if (!bad || !good) throw new Error(`spell-list.txt: bad line "${l}"`); m.set(bad.toLowerCase(), good); }
  return m;
}
/** Phrases that overstate what Centcom does (copy privacy claims from the contract, do not improve on them), and strings that look like real secrets. */
export const BANNED: [RegExp, string][] = [
  [/zero[- ]knowledge/i, 'a claim the crypto contract does not make'], [/military[- ]grade/i, 'marketing, not a guarantee'], [/\bunhackable\b|\bunbreakable\b/i, 'no system is'],
  [/\b100\s?% (secure|private|safe)/i, 'an absolute the contract does not give'], [/\bcannot be (hacked|broken|intercepted)\b/i, 'an absolute the contract does not give'],
  [/\bcen_(live|test)_[A-Za-z0-9]{12,}/, 'looks like a real API key; use a truncated placeholder like cen_live_…'], [/\bses_[0-9A-Z]{20,}\b/, 'looks like a real id; use a placeholder like ses_01JA…'],
];
/** The prose of a page: fenced code, inline code, link targets, HTML comments and URLs blanked out (line numbers stay). */
export function prose(md: string): string {
  const blank = (m: string) => m.replace(/[^\n]/g, ' ');
  return md.replace(/```[\s\S]*?```/g, blank).replace(/<!--[\s\S]*?-->/g, blank).replace(/`[^`\n]*`/g, blank).replace(/\]\([^)]*\)/g, '] ').replace(/https?:\/\/\S+/g, ' ');
}
export function spellProblems(pages: Record<string, string>, list: Map<string, string> = loadList()): SpellProblem[] {
  const out: SpellProblem[] = [];
  for (const [file, md] of Object.entries(pages)) {
    const text = prose(md);
    for (const [re, why] of BANNED) { const m = re.exec(md); if (m) out.push({ where: file, what: `"${m[0]}": ${why}` }); }
    const seen = new Set<string>();
    for (const m of text.matchAll(/[A-Za-z][A-Za-z']*/g)) { const w = m[0].toLowerCase(); const good = list.get(w); if (good && !seen.has(w)) { seen.add(w); out.push({ where: file, what: `"${m[0]}" is a misspelling of "${good}"` }); } }
  }
  return out;
}
