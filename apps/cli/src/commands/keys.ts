/** `centcom keys [--json]`: every action and its keys (defaults plus your keybindings.json). Warnings about the file go to stderr; the exit code is 0 either way. */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { defaultDeps, userConfigPath } from '@centcom/config';
import { actions, defaultKeymap, EDITING_KEYS, grouped, helpRows, loadKeymap } from '@centcom/tui';

export const keybindingsPath = () => join(dirname(userConfigPath(defaultDeps())), 'keybindings.json');
export function resolvedKeys(file = keybindingsPath()) { return loadKeymap({ defaults: defaultKeymap(actions()), userFile: file, actions: actions(), fs: { read: (p) => { try { return readFileSync(p, 'utf8'); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw e; } } } }); }
export function runKeys(argv: string[], io: { out(l: string): void; err(l: string): void }, file?: string): number {
  const { keymap, warnings } = resolvedKeys(file); for (const w of warnings) io.err(`keybindings.json: ${w.message}`);
  const rows = helpRows(actions(), keymap).sort((a, b) => a.id.localeCompare(b.id));
  if (argv.includes('--json')) { io.out(JSON.stringify(rows.map((r) => ({ id: r.id, group: r.group, description: r.description, keys: r.keys, context: r.context })), null, 2)); return 0; }
  for (const [g, list] of grouped(helpRows(actions(), keymap))) { io.out(g); for (const r of list) io.out(`  ${(r.keys.join(', ') || '(none)').padEnd(18)} ${r.description}  [${r.id}]`); }
  io.out('Editing'); for (const [k, d] of EDITING_KEYS) io.out(`  ${k.padEnd(18)} ${d}`); io.out(`Your overrides: ${file ?? keybindingsPath()}`); return 0;
}
