/** Local developer overrides for flags: config key `flags.overrides` and env `CENTCOM_FLAGS=key=value,...` (env wins over config).
 *  Both are honoured only in a dev build or with `CENTCOM_DEV=1`; a stable release build ignores them and says so once.
 *  Must not: let an override name a key that is not in the registry, or carry a value of the wrong type. */
import { FLAG_KEY_RE, typed, type FlagDef, type FlagValue } from './registry.js';

export const FLAGS_ENV = 'CENTCOM_FLAGS';
export const FLAGS_CONFIG_KEY = 'flags.overrides';
/** At most this many overrides are read from one source. */
const MAX_OVERRIDES = 100;

/** Turn `a=true,b.c=3,d=text` (or an object) into raw string/boolean/number values. Malformed entries are skipped. */
export function parseOverrides(src: unknown): Record<string, FlagValue> {
  const out: Record<string, FlagValue> = {};
  if (src && typeof src === 'object' && !Array.isArray(src)) {
    for (const [k, v] of Object.entries(src as Record<string, unknown>).slice(0, MAX_OVERRIDES)) if (FLAG_KEY_RE.test(k) && (typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v)))) out[k] = v;
    return out;
  }
  if (typeof src !== 'string') return out;
  for (const part of src.split(',').slice(0, MAX_OVERRIDES)) {
    const i = part.indexOf('='); if (i <= 0) continue;
    const k = part.slice(0, i).trim(); const v = part.slice(i + 1).trim(); if (FLAG_KEY_RE.test(k)) out[k] = v;
  }
  return out;
}

/** A raw override as the flag's type: 'true'/'false'/'1'/'0' for booleans, a finite number for numbers, any text for strings. */
export function coerce<T extends FlagValue>(def: FlagDef<T>, v: FlagValue): T | undefined {
  if (typeof v !== 'string') return typed(def, v);
  if (def.type === 'boolean') { const s = v.toLowerCase(); return (s === 'true' || s === '1' ? true : s === 'false' || s === '0' ? false : undefined) as T | undefined; }
  if (def.type === 'number') { const n = Number(v); return (v !== '' && Number.isFinite(n) ? n : undefined) as T | undefined; }
  return v as T;
}

/** Are overrides allowed at all? Dev builds always; release builds only with CENTCOM_DEV=1. */
export const overridesAllowed = (isDevBuild: boolean, env: Record<string, string | undefined>): boolean => isDevBuild || env.CENTCOM_DEV === '1';

/** The overrides in force, typed against the registry: config first, env on top, nothing unless allowed.
 *  `ignored` is true when overrides were set but refused (the caller warns once). */
export function resolveOverrides(o: { defs: Record<string, FlagDef>; config: unknown; env: Record<string, string | undefined>; isDevBuild: boolean }): { values: Record<string, FlagValue>; ignored: boolean; unknown: string[] } {
  const raw = { ...parseOverrides(o.config), ...parseOverrides(o.env[FLAGS_ENV]) };
  if (!Object.keys(raw).length) return { values: {}, ignored: false, unknown: [] };
  if (!overridesAllowed(o.isDevBuild, o.env)) return { values: {}, ignored: true, unknown: [] };
  const values: Record<string, FlagValue> = {}; const unknown: string[] = [];
  for (const [k, v] of Object.entries(raw)) {
    const def = Object.hasOwn(o.defs, k) ? o.defs[k] : undefined; if (!def) { unknown.push(k); continue; }
    const t = coerce(def, v); if (t === undefined) unknown.push(k); else values[k] = t;
  }
  return { values, ignored: false, unknown };
}
