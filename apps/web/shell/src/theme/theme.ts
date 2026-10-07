import { useSyncExternalStore } from 'react';
export type ThemeChoice = 'dark' | 'light' | 'auto'; const KEY = 'centcom.theme';
const read = (): ThemeChoice => { try { const v = localStorage.getItem(KEY); return v === 'dark' || v === 'light' || v === 'auto' ? v : 'auto'; } catch { return 'auto'; } };
let current: ThemeChoice = read(); const fns = new Set<() => void>();
/** `auto` removes the attribute so the stylesheet's `prefers-color-scheme` rule decides. The switch is immediate: no transition. */
export function applyTheme(t: ThemeChoice, root: { setAttribute(k: string, v: string): void; removeAttribute(k: string): void } = document.documentElement): void { if (t === 'auto') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', t); }
export function setTheme(t: ThemeChoice): void { current = t; try { localStorage.setItem(KEY, t); } catch { /* private window: the choice lasts for this visit */ } applyTheme(t); for (const f of [...fns]) f(); }
export function useTheme(): { theme: ThemeChoice; set(t: ThemeChoice): void } { const theme = useSyncExternalStore((f) => { fns.add(f); return () => { fns.delete(f); }; }, () => current, () => 'auto' as ThemeChoice); return { theme, set: setTheme }; }
export const initTheme = (): void => { current = read(); applyTheme(current); };
/** WCAG contrast of two #rrggbb colours (used by the token test). */
export function contrast(a: string, b: string): number { const lum = (h: string): number => { const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!; }; const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p) as [number, number]; return (x + 0.05) / (y + 0.05); }
