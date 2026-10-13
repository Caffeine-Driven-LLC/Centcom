import { detectLocale, setLocale } from './index.js';

/**
 * Picks the language when the app starts: the person's saved choice (`me`, from `/v1/me` once known), then the browser's languages, then
 * English. A language that is not available falls back to English; `<html lang>` follows. English is inlined, so nothing is fetched for it.
 */
export async function bootLocale(o: { me?: string; navigator?: readonly string[] } = {}): Promise<string> {
  const nav = o.navigator ?? (typeof navigator !== 'undefined' ? navigator.languages : []); const tag = detectLocale({ ...(o.me ? { me: o.me } : {}), navigator: nav });
  await setLocale(tag); return tag;
}
