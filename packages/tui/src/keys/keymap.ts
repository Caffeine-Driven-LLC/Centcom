/** The resolved keymap: per context, a key (formatted) to one action. User overrides come from keybindings.json; nothing in it is ever run as code. */
import { CONTEXTS, PROTECTED, type ActionDef, type KeyContext } from './actions.js';
import { formatKey, KeyParseError, parseKey } from './parse.js';

export type Keymap = Map<KeyContext, Map<string, string>>;
export interface KeymapWarning { code: 'invalid_file' | 'bad_entry' | 'unknown_action' | 'bad_key' | 'conflict' | 'protected' | 'reserved'; message: string }
export interface KeymapFs { read(p: string): string | undefined }
/** ctrl+c belongs to interrupt-or-quit and is never bindable. */
const RESERVED = ['ctrl+c'];

function put(map: Keymap, ctx: KeyContext, key: string, action: string, warnings: KeymapWarning[], source: string): void {
  const m = map.get(ctx)!; const cur = m.get(key); if (cur && cur !== action) { warnings.push({ code: 'conflict', message: `${key} in ${ctx} is already ${cur}; ${source} ${action} on it was ignored.` }); return; } m.set(key, action);
}
export function defaultKeymap(actions: ActionDef[]): Keymap { const map: Keymap = new Map(CONTEXTS.map((c) => [c, new Map()])); const w: KeymapWarning[] = []; for (const a of actions) for (const d of a.defaults) { const k = parseKey(d.key); if (!(k instanceof KeyParseError)) put(map, d.context, formatKey(k), a.id, w, 'default'); } return map; }
export function bindingsOf(map: Keymap, action: string): { key: string; context: KeyContext }[] { const out: { key: string; context: KeyContext }[] = []; for (const [c, m] of map) for (const [k, a] of m) if (a === action) out.push({ key: k, context: c }); return out; }

export function loadKeymap(d: { defaults: Keymap; userFile?: string; actions: ActionDef[]; fs?: KeymapFs }): { keymap: Keymap; warnings: KeymapWarning[] } {
  const keymap: Keymap = new Map([...d.defaults].map(([c, m]) => [c, new Map(m)])); const warnings: KeymapWarning[] = []; const ids = new Set(d.actions.map((a) => a.id));
  let raw: string | undefined; try { raw = d.userFile ? d.fs?.read(d.userFile) : undefined; } catch { warnings.push({ code: 'invalid_file', message: 'keybindings.json could not be read; the defaults are used.' }); }
  if (raw !== undefined && raw.trim()) {
    let j: unknown; try { j = JSON.parse(raw); } catch { warnings.push({ code: 'invalid_file', message: 'keybindings.json is not valid JSON; the defaults are used.' }); j = undefined; }
    if (j !== undefined && (typeof j !== 'object' || j === null || Array.isArray(j) || Object.keys(j).some((k) => k !== 'bindings' && k !== 'unbind' && k !== '$schema'))) { warnings.push({ code: 'invalid_file', message: 'keybindings.json should be { "bindings": [...], "unbind": [...] }; the defaults are used.' }); j = undefined; }
    const o = (j ?? {}) as { bindings?: unknown; unbind?: unknown };
    if (o.unbind !== undefined) { if (!Array.isArray(o.unbind)) warnings.push({ code: 'bad_entry', message: '"unbind" should be a list of keys.' }); else for (const u of o.unbind) { if (typeof u !== 'string') { warnings.push({ code: 'bad_entry', message: 'An "unbind" entry is not text; skipped.' }); continue; } const k = parseKey(u); if (k instanceof KeyParseError) { warnings.push({ code: 'bad_key', message: `${k.message}; skipped.` }); continue; } for (const m of keymap.values()) m.delete(formatKey(k)); } }
    if (o.bindings !== undefined) { if (!Array.isArray(o.bindings)) warnings.push({ code: 'bad_entry', message: '"bindings" should be a list.' }); else for (const b of o.bindings as unknown[]) {
      const e = b as { key?: unknown; action?: unknown; context?: unknown }; if (!e || typeof e !== 'object' || typeof e.key !== 'string' || typeof e.action !== 'string' || (e.context !== undefined && typeof e.context !== 'string')) { warnings.push({ code: 'bad_entry', message: 'A binding needs "key" and "action" (and may have "context"); skipped.' }); continue; }
      if (!ids.has(e.action)) { warnings.push({ code: 'unknown_action', message: `There is no action "${e.action}"; skipped.` }); continue; }
      const ctx = (e.context ?? 'global') as KeyContext; if (!CONTEXTS.includes(ctx)) { warnings.push({ code: 'bad_entry', message: `Unknown context "${e.context}"; skipped.` }); continue; }
      const k = parseKey(e.key); if (k instanceof KeyParseError) { warnings.push({ code: 'bad_key', message: `${k.message}; skipped.` }); continue; } const key = formatKey(k);
      if (RESERVED.includes(key)) { warnings.push({ code: 'reserved', message: `${key} is reserved for interrupt and quit; skipped.` }); continue; }
      put(keymap, ctx, key, e.action, warnings, 'your');
    } }
  }
  for (const p of PROTECTED) if (!bindingsOf(keymap, p).length) { const a = d.actions.find((x) => x.id === p); for (const def of a?.defaults ?? []) { const k = parseKey(def.key); if (!(k instanceof KeyParseError)) keymap.get(def.context)!.set(formatKey(k), p); } warnings.push({ code: 'protected', message: `${p} must keep a key, so its default came back.` }); }
  return { keymap, warnings };
}
