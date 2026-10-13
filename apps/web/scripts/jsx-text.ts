/**
 * `pnpm exec tsx apps/web/scripts/jsx-text.ts [--write]`: finds words written straight into the screens' markup instead of coming from the
 * message table (`t('key')`): text between JSX tags, and the text attributes `aria-label`, `title`, `placeholder` and `alt`. The count per
 * file is compared with `apps/web/test/a11y-i18n/jsx-text.baseline.json` by `i18n.jsx-text.test.ts`: a file may never get more of them than
 * it has there, and a file that is not in the baseline may have none. `--write` rewrites the baseline after text has moved into the table.
 * Tests and stories are exempt (they are not under `src/`).
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';

const here = new URL('.', import.meta.url).pathname;
export const SRC = join(here, '../src'); export const BASELINE = join(here, '../test/a11y-i18n/jsx-text.baseline.json');
const TEXT_ATTRS = new Set(['aria-label', 'title', 'placeholder', 'alt']);
/** Words: at least two letters in a row, after entities and punctuation are ignored. A lone symbol, number or separator is not text. */
export const hasWords = (s: string): boolean => /\p{L}{2}/u.test(s.replace(/&[a-z#0-9]+;/gi, ' '));
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));

export function scanSource(file: string, text: string): { line: number; text: string }[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX); const found: { line: number; text: string }[] = [];
  const at = (n: ts.Node, t: string): void => { found.push({ line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1, text: t.trim().replace(/\s+/g, ' ').slice(0, 60) }); };
  const visit = (n: ts.Node): void => {
    if (ts.isJsxText(n) && hasWords(n.text)) at(n, n.text);
    else if (ts.isJsxAttribute(n) && TEXT_ATTRS.has(n.name.getText(sf)) && n.initializer && ts.isStringLiteral(n.initializer) && hasWords(n.initializer.text)) at(n, n.initializer.text);
    ts.forEachChild(n, visit);
  };
  visit(sf); return found;
}
export function scan(src: string = SRC): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of walk(src).filter((x) => x.endsWith('.tsx') && !x.includes('/i18n/'))) { const n = scanSource(f, readFileSync(f, 'utf8')).length; if (n) out[relative(src, f)] = n; }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop()!)) {
  const now = scan(); const total = Object.values(now).reduce((a, b) => a + b, 0);
  if (process.argv.includes('--write')) { writeFileSync(BASELINE, JSON.stringify(now, null, 2) + '\n'); console.log(`baseline written: ${total} raw texts in ${Object.keys(now).length} files`); }
  else console.log(`${total} raw texts in ${Object.keys(now).length} files`);
}
