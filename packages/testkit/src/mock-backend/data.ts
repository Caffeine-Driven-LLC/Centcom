/** The `--data` seed loader. A directory may hold `users.json`, `workspaces.json`, `sessions.json` and `entitlements.json`,
 *  each an array whose items must match the OpenAPI component schema named in SEED_FILES. Missing files are fine; a bad
 *  file stops the mock (MockInputError, CLI exit 2). Default seed content belongs to lane C011, not here. */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { SeedData } from './state.js';
import { MockInputError, type FileIssue } from './scenarios.js';

/** File name stem -> OpenAPI component schema its items must match. */
export const SEED_FILES = { users: 'User', workspaces: 'Workspace', sessions: 'Session', entitlements: 'Entitlements' } as const;
type Check = (x: unknown) => { ok: boolean; errors: { pointer: string; message: string }[] };
/** Each seed file is read whole; this caps it (no unbounded reads). */
export const SEED_FILE_MAX_BYTES = 8 * 1024 * 1024;

/** Read and validate a seed directory. `check(schema)` returns a validator for one component schema. */
export function loadSeedData(dir: string, check: (schema: string) => Check): SeedData {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new MockInputError([{ pointer: '', message: 'not a directory' }], `--data ${dir}`);
  const out: SeedData = {}; const issues: FileIssue[] = [];
  for (const [stem, schema] of Object.entries(SEED_FILES) as [keyof SeedData, string][]) {
    const file = `${stem}.json`; const path = join(dir, file); if (!existsSync(path)) continue;
    if (statSync(path).size > SEED_FILE_MAX_BYTES) { issues.push({ file, pointer: '', message: `larger than ${SEED_FILE_MAX_BYTES} bytes` }); continue; }
    let raw: unknown; try { raw = JSON.parse(readFileSync(path, 'utf8')); } catch (e) { issues.push({ file, pointer: '', message: `not JSON (${(e as Error).message})` }); continue; }
    if (!Array.isArray(raw)) { issues.push({ file, pointer: '', message: 'must be an array' }); continue; }
    const v = check(schema); const ids = new Set<string>(); let bad = false;
    raw.forEach((item, i) => {
      const r = v(item); for (const e of r.errors) issues.push({ file, pointer: `/${i}${e.pointer}`, message: e.message }); if (!r.ok) bad = true;
      const id = stem === 'entitlements' ? (item as { workspace?: unknown })?.workspace : (item as { id?: unknown })?.id;
      if (typeof id === 'string') { if (ids.has(id)) { issues.push({ file, pointer: `/${i}`, message: `duplicate ${stem === 'entitlements' ? 'workspace' : 'id'} ${id}` }); bad = true; } ids.add(id); }
    });
    if (!bad) out[stem] = raw as Record<string, unknown>[];
  }
  if (issues.length) throw new MockInputError(issues, `--data ${dir}`);
  return out;
}
