import { useSyncExternalStore } from 'react';
import en from './en.json';
import { format } from './plural.js';
import { pseudo } from './pseudo.js';

export type MessageKey = keyof typeof en;
export type Messages = Record<string, string>;
const loaders: Record<string, () => Promise<{ default: Messages }>> = {};
/** Adds a language that loads on demand (its own chunk). English is inlined. */
export function registerLocale(tag: string, load: () => Promise<{ default: Messages }>): void { loaders[tag] = load; }
let locale = 'en'; let table: Messages = en; const fns = new Set<() => void>();
const apply = (tag: string, t: Messages): void => { locale = tag; table = t; if (typeof document !== 'undefined') document.documentElement.lang = tag === 'en-XA' ? 'en' : tag; for (const f of [...fns]) f(); };
/** Words for a key, with parameters; a key missing from the current language falls back to English, and an unknown key shows as itself (a build check catches those). */
export function t(key: MessageKey, params?: Record<string, string | number>): string { const m = (table as Record<string, string | undefined>)[key] ?? (en as Record<string, string>)[key] ?? key; return format(locale === 'en-XA' ? m : m, params); }
/** Same as `t`: the pseudo-locale already has its words expanded in the table. */
export const tp = t;
export async function setLocale(tag: string): Promise<void> {
  if (tag === 'en') return apply('en', en); if (tag === 'en-XA') return apply('en-XA', Object.fromEntries(Object.entries(en).map(([k, v]) => [k, pseudo(v)])));
  const base = tag.split('-')[0]!; const load = loaders[tag] ?? loaders[base]; if (!load) return apply('en', en); try { apply(tag, (await load()).default); } catch { apply('en', en); }
}
/** The person's choice first (`/v1/me` locale), then the browser's languages, then English. */
export function detectLocale(o: { me?: string; navigator?: readonly string[]; available?: readonly string[] } = {}): string {
  const have = new Set(['en', 'en-XA', ...Object.keys(loaders), ...(o.available ?? [])]); for (const c of [o.me, ...(o.navigator ?? [])]) { if (!c) continue; if (have.has(c)) return c; const b = c.split('-')[0]!; if (have.has(b)) return b; } return 'en';
}
export function useLocale(): { locale: string; set(l: string): Promise<void> } { const l = useSyncExternalStore((f) => { fns.add(f); return () => { fns.delete(f); }; }, () => locale, () => 'en'); return { locale: l, set: setLocale }; }
export const currentLocale = (): string => locale;
export { format };
/** Dates, numbers and money in the person's language. */
export const fmt = {
  date: (d: Date | number, o: Intl.DateTimeFormatOptions = { dateStyle: 'medium' }): string => new Intl.DateTimeFormat(locale === 'en-XA' ? 'en' : locale, o).format(d),
  number: (n: number, o?: Intl.NumberFormatOptions): string => new Intl.NumberFormat(locale === 'en-XA' ? 'en' : locale, o).format(n),
  money: (cents: number, currency: string): string => new Intl.NumberFormat(locale === 'en-XA' ? 'en' : locale, { style: 'currency', currency }).format(cents / 100),
};
