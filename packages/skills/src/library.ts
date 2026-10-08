/** The skill library that ships with Centcom: design, frontend, backend, security, database, marketing and code-review. Each is a SKILL.md plus references/ (read only when the task needs that depth) and small stdlib-only scripts. */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFrontmatter, type Skill } from './index.js';

export const LIBRARY_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'library');
/** The library's skills as plain Skills (source `bundled`), so the matcher treats them like any other. Missing library folder: none. */
export function librarySkills(dir = LIBRARY_DIR): Skill[] {
  let names: string[]; try { names = readdirSync(dir).sort(); } catch { return []; }
  const out: Skill[] = [];
  for (const n of names) {
    const file = join(dir, n, 'SKILL.md'); if (!existsSync(file)) continue;
    const fm = parseFrontmatter(readFileSync(file, 'utf8')); if (!fm.name || !fm.description) continue;
    out.push({ name: fm.name, description: fm.description.slice(0, 1200), kind: 'skill', source: 'bundled', path: file });
  }
  return out;
}
/** Your project's own skills win over the library; the library wins over same-named skills from your user folder or plugins (including the small Centcom pack's `code-review`). */
export function mergeLibrary(own: Skill[], library: Skill[]): Skill[] {
  const project = new Set(own.filter((s) => s.source === 'project' && s.kind === 'skill').map((s) => s.name.toLowerCase())); const lib = new Set(library.map((s) => s.name.toLowerCase()));
  return [...own.filter((s) => !(s.kind === 'skill' && lib.has(s.name.toLowerCase()) && !project.has(s.name.toLowerCase()))), ...library.filter((s) => !project.has(s.name.toLowerCase()))];
}
