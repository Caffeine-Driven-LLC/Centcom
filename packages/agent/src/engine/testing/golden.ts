import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** Compares events with a stored golden file. `UPDATE_GOLDEN=1` rewrites it (needs a reviewer note); a missing file fails instead of silently passing. */
export function expectGolden(events: unknown[], file: string): void {
  const text = JSON.stringify(events, null, 1) + '\n';
  if (process.env.UPDATE_GOLDEN === '1') { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text); return; }
  if (!existsSync(file)) throw new Error(`Golden file ${file} does not exist. Run once with UPDATE_GOLDEN=1 and have the result reviewed.`);
  const want = readFileSync(file, 'utf8'); if (want !== text) throw new Error(`Events differ from golden ${file}. If the change is intended, rerun with UPDATE_GOLDEN=1 and add a reviewer note.`);
}
