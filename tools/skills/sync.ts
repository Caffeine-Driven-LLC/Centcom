/** pnpm skills:sync [--only owner/repo,...]   Fetch the catalog into ~/.centcom/master (text only, pinned, scanned). */
import { readFileSync } from 'node:fs';
import { MASTER_DIR, parseCatalog, sync } from '../../packages/skills/src/index.ts';

const i = process.argv.indexOf('--only');
const only = i >= 0 ? process.argv[i + 1]!.split(',') : undefined;
const catalog = parseCatalog(readFileSync(new URL('../../packages/skills/catalog.tsv', import.meta.url), 'utf8'));
const entries = await sync({ catalog, only, log: (s) => console.log(s) });
const by = (st: string) => entries.filter((e) => e.status === st).length;
const on = entries.filter((e) => e.enabled && e.status === 'ok').length;
console.log(`\n${entries.length} catalog rows → ok ${by('ok')} · quarantined ${by('quarantined')} · missing ${by('missing')} · clone-failed ${by('clone-failed')} · no-source ${by('no-source')}\nenabled by default: ${on}\n→ ${MASTER_DIR}`);
