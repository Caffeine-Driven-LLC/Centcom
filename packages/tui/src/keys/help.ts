/** What the help screen lists: every action with its live keys, grouped, plus the prompt's own editing keys. Pure, so the CLI's `centcom keys` prints the same. */
import type { ActionDef, KeyContext } from './actions.js';
import { bindingsOf, type Keymap } from './keymap.js';

export interface HelpRow { id: string; group: string; description: string; keys: string[]; context: KeyContext }
/** Keys the prompt handles itself (lane C035); listed for completeness, not remappable here. */
export const EDITING_KEYS: [string, string][] = [
  ['enter', 'send'], ['ctrl+j', 'new line (also \\ then enter)'], ['ctrl+c', 'copy the selection; otherwise interrupt, twice to quit'], ['up / down', 'prompt history'],
  ['ctrl+a / ctrl+e', 'line start / end'], ['alt+b / alt+f', 'word left / right'], ['shift+left/right', 'jump a word and select it'], ['shift+home/end', 'select to the line start / end'],
  ['alt+a', 'select all'], ['ctrl+x', 'cut the selection'], ['ctrl+w', 'delete the word before'], ['ctrl+delete', 'delete the word after'], ['ctrl+u', 'delete to line start'], ['mouse wheel', 'scroll (/mouse off to select text with the mouse)'],
];
export function helpRows(actions: ActionDef[], keymap: Keymap, filter = ''): HelpRow[] {
  const f = filter.trim().toLowerCase();
  return actions.map((a) => { const b = bindingsOf(keymap, a.id); return { id: a.id, group: a.group, description: a.description, keys: b.map((x) => x.key), context: (b[0]?.context ?? a.defaults[0]?.context ?? 'global') as KeyContext }; })
    .filter((r) => !f || `${r.id} ${r.description} ${r.keys.join(' ')} ${r.group}`.toLowerCase().includes(f));
}
export const GROUP_ORDER = ['General', 'Agent', 'Approvals', 'Panels', 'Transcript'];
export function grouped(rows: HelpRow[]): [string, HelpRow[]][] { const m = new Map<string, HelpRow[]>(); for (const r of rows) m.set(r.group, [...(m.get(r.group) ?? []), r]); return [...m].sort((a, b) => (GROUP_ORDER.indexOf(a[0]) + 99) % 99 - (GROUP_ORDER.indexOf(b[0]) + 99) % 99); }
