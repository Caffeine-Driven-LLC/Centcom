import { createTheme } from '@centcom/theme';

const TOKENS = ['bg.base', 'bg.surface', 'bg.raised', 'bg.overlay', 'bg.sunken', 'bg.hover', 'bg.selected', 'border.subtle', 'border.default', 'border.strong', 'text.primary', 'text.secondary', 'text.muted', 'text.link', 'accent.primary', 'accent.fill', 'accent.hover', 'accent.on', 'signal', 'status.success', 'status.warning', 'status.danger', 'status.info'] as const;
export type ThemePref = 'system' | 'dark' | 'light';
const KEY = 'centcom.theme';
const safe = <T,>(f: () => T, d: T): T => { try { return f(); } catch { return d; } };
export const getThemePref = (): ThemePref => safe(() => (localStorage.getItem(KEY) as ThemePref) || 'system', 'system');

export function applyTheme(pref: ThemePref = getThemePref()) {
  const mode = pref === 'system' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : pref;
  const t = createTheme(mode, 'truecolor');
  for (const k of TOKENS) document.documentElement.style.setProperty('--' + k.replace('.', '-'), t.c(k));
  document.documentElement.dataset.theme = mode;
}
export function setThemePref(pref: ThemePref) { safe(() => localStorage.setItem(KEY, pref), undefined); applyTheme(pref); }

/** The server calls "follow the system" `auto`; the page calls it `system`. */
export const fromServer = (t: 'auto' | 'dark' | 'light'): ThemePref => (t === 'auto' ? 'system' : t);
export const toServer = (t: ThemePref): 'auto' | 'dark' | 'light' => (t === 'system' ? 'auto' : t);
