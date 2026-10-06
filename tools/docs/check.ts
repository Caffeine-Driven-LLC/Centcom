/** `pnpm docs:check`: the generated pages are current, the docs and the code agree about flags and environment variables, and every internal link and anchor resolves. */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMMANDS } from '../../apps/cli/src/help/commands.js';
import { topHelp } from '../../apps/cli/src/help/render.js';
import { ENV_VARS, RELAY_NEVER, RELAY_VISIBLE, TRAFFIC_NOTE } from '../../apps/cli/src/help/topics.js';
import { check as generatedDrift, sourcesText } from './gen-cli-reference.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url)); const SITE = join(ROOT, 'docs/site');
const walk = (d: string): string[] => (existsSync(d) ? readdirSync(d).flatMap((f) => { const p = join(d, f); return f === 'node_modules' || f === '.vitepress' ? [] : statSync(p).isDirectory() ? walk(p) : [p]; }) : []);
export const slug = (h: string): string => h.toLowerCase().replace(/`/g, '').replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s+/g, '-');
export function anchorsOf(md: string): Set<string> { const s = new Set<string>(); for (const m of md.matchAll(/^#{1,6}\s+(.+)$/gm)) s.add(slug(m[1]!)); return s; }

export interface Problem { where: string; what: string }
/** Internal links of the pages in `files`: the target file must exist, and so must its anchor. */
export function linkProblems(files: string[], read: (p: string) => string | undefined = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : undefined)): Problem[] {
  const out: Problem[] = [];
  for (const f of files) { const md = read(f) ?? ''; for (const m of md.matchAll(/\]\(([^)\s]+)\)/g)) { const href = m[1]!; if (/^(https?:|mailto:|#)/.test(href) && !href.startsWith('#')) continue;
      const [path, anchor] = href.split('#'); const target = path ? resolve(dirname(f), path) : f; const text = read(target) ?? (read(join(target, 'index.md'))); const file = relative(ROOT, f);
      if (text === undefined) { out.push({ where: file, what: `link to ${href} goes nowhere` }); continue; } if (anchor && !anchorsOf(text).has(anchor)) out.push({ where: file, what: `link to ${href}: no heading "${anchor}"` }); } }
  return out;
}
/** Every flag of every command must be in the top-level help text of the CLI, and every command too. */
export function flagProblems(help: string): Problem[] {
  const out: Problem[] = [];
  for (const c of COMMANDS) { if (c.name !== 'centcom' && !help.includes(`centcom ${c.name}`)) out.push({ where: 'apps/cli/src/help/render.ts', what: `the top-level help does not list the "${c.name}" command` });
    if (c.name === 'centcom') for (const f of c.flags) for (const name of f.flag.split(/,\s*/)) if (!help.includes(name.trim())) out.push({ where: 'apps/cli/src/help/render.ts', what: `the top-level help does not mention ${name.trim()}` }); }
  return out;
}
/** The environment page must list exactly the variables the code reads (never one that is not there). */
export function envProblems(page: string, sources: string): Problem[] { return [...ENV_VARS.filter((v) => page.includes(`\`${v.name}\``) && !sources.includes(v.name)).map((v) => ({ where: 'docs/site/reference/env.md', what: `${v.name} is documented but does not exist in the code` })), ...ENV_VARS.filter((v) => sources.includes(v.name) && !page.includes(`\`${v.name}\``)).map((v) => ({ where: 'docs/site/reference/env.md', what: `${v.name} exists in the code but is not documented` }))]; }
export function privacyProblems(page: string): Problem[] { return [...RELAY_VISIBLE, ...RELAY_NEVER, TRAFFIC_NOTE].filter((x) => !page.includes(x)).map((x) => ({ where: 'docs/site/guide/privacy-relay.md', what: `missing: ${x.slice(0, 50)}` })); }

export function all(): Problem[] {
  const out: Problem[] = generatedDrift().map((p) => ({ where: p, what: 'is out of date (run pnpm docs:gen)' }));
  out.push(...flagProblems(topHelp('0.0.0')));
  out.push(...envProblems(readFileSync(join(SITE, 'reference/env.md'), 'utf8'), sourcesText()));
  out.push(...privacyProblems(readFileSync(join(SITE, 'guide/privacy-relay.md'), 'utf8'))); out.push(...linkProblems(walk(SITE).filter((f) => f.endsWith('.md'))));
  const priv = readFileSync(join(SITE, 'guide/privacy.md'), 'utf8'); if (!priv.includes('privacy-relay.md')) out.push({ where: 'docs/site/guide/privacy.md', what: 'does not include the generated relay list' });
  return out;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) { const p = all(); if (p.length) { console.error(p.map((x) => `${x.where}: ${x.what}`).join('\n')); process.exit(1); } console.log('docs check passed'); }
