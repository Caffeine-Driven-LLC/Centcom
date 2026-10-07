import React, { useEffect, useState } from 'react';
import { t, type MessageKey } from '../i18n/index.js';
import { Modal } from '../ui/index.js';
export interface ShortcutDef { id: string; keys: string; labelKey: MessageKey; scope: string; handler(): void }
const defs = new Map<string, ShortcutDef>(); const remap = new Map<string, string>(); const fns = new Set<() => void>(); let onConflict: (m: string) => void = (m) => { if (typeof console !== 'undefined') console.error(m); };
export const setConflictLogger = (f: (m: string) => void): void => { onConflict = f; };
const notify = (): void => { for (const f of [...fns]) f(); };
/** Normal form of a key combo: `ctrl+shift+k`. */
export const normaliseKeys = (k: string): string => { const p = k.toLowerCase().split('+').map((x) => x.trim()); const mods = ['ctrl', 'alt', 'shift', 'meta'].filter((m) => p.includes(m)); return [...mods, ...p.filter((x) => !['ctrl', 'alt', 'shift', 'meta'].includes(x))].join('+'); };
export const keysOf = (id: string): string => normaliseKeys(remap.get(id) ?? defs.get(id)?.keys ?? '');
function conflict(id: string, keys: string, scope: string): ShortcutDef | undefined { for (const d of defs.values()) if (d.id !== id && d.scope === scope && keysOf(d.id) === normaliseKeys(keys)) return d; return undefined; }
export function registerShortcut(def: ShortcutDef): () => void { const c = conflict(def.id, def.keys, def.scope); if (c) onConflict(`Shortcut conflict: ${def.keys} is used by ${c.id} and ${def.id}`); defs.set(def.id, def); notify(); return () => { defs.delete(def.id); notify(); }; }
/** Remapping: refused (with the other action's name) when the keys are taken in the same scope. */
export function remapShortcut(id: string, keys: string): { ok: true } | { ok: false; other: string } { const d = defs.get(id); if (!d) return { ok: false, other: '' }; const c = conflict(id, keys, d.scope); if (c) return { ok: false, other: c.id }; remap.set(id, normaliseKeys(keys)); notify(); return { ok: true }; }
export const resetShortcuts = (): void => { defs.clear(); remap.clear(); notify(); };
export const listShortcuts = (): { id: string; keys: string; labelKey: MessageKey; scope: string }[] => [...defs.values()].map((d) => ({ id: d.id, keys: keysOf(d.id), labelKey: d.labelKey, scope: d.scope }));
export function eventKeys(e: { key: string; ctrlKey?: boolean; altKey?: boolean; shiftKey?: boolean; metaKey?: boolean }): string { const k = e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase(); return normaliseKeys([e.ctrlKey && 'ctrl', e.altKey && 'alt', e.shiftKey && e.key.length > 1 && 'shift', e.metaKey && 'meta', k].filter(Boolean).join('+')); }
/** One key listener for the page: runs the matching shortcut, except while someone types in a field. `?` opens the list. */
export function ShortcutHost({ children }: { children?: React.ReactNode }): React.JSX.Element {
  const [open, setOpen] = useState(false); const [, bump] = useState(0);
  useEffect(() => { const f = (): void => bump((x) => x + 1); fns.add(f); const on = (e: KeyboardEvent): void => { const el = e.target as HTMLElement | null; if (el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable)) return; const k = eventKeys(e); if (k === '?' || k === 'shift+/') { e.preventDefault(); setOpen(true); return; } for (const d of defs.values()) if (keysOf(d.id) === k) { e.preventDefault(); d.handler(); return; } }; document.addEventListener('keydown', on); return () => { fns.delete(f); document.removeEventListener('keydown', on); }; }, []);
  return <>{children}<Modal open={open} title={t('a11y.shortcuts.title')} onClose={() => setOpen(false)}><table className="cc-table"><caption className="cc-vh">{t('a11y.shortcuts.title')}</caption><tbody>{listShortcuts().map((s) => <tr key={s.id}><th scope="row">{t(s.labelKey)}</th><td><kbd>{s.keys}</kbd></td></tr>)}</tbody></table><button type="button" className="cc-btn" onClick={() => setOpen(false)}>{t('a11y.shortcuts.close')}</button></Modal></>;
}
