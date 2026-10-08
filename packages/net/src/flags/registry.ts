/** The typed flag registry (CT-API-FLAGS). Each feature lane adds its key here in its own PR (this lane reviews):
 *  one line in `FlagRegistry` and one `defineFlag` in `FLAG_DEFS`; the compiler refuses one without the other.
 *  Flags only switch user-visible features on or off (GUIDELINES §6.5). Must not: gate sandboxing, permissions or crypto defaults. */

export type FlagValue = boolean | string | number;
export type FlagType = 'boolean' | 'string' | 'number';
type TypeOf<T> = T extends boolean ? 'boolean' : T extends number ? 'number' : 'string';
export interface FlagDef<T extends FlagValue = FlagValue> { readonly key: string; readonly type: TypeOf<T>; readonly default: T }
/** Server flag keys (CT-API-FLAGS). */
export const FLAG_KEY_RE = /^[a-z0-9_.-]{1,64}$/;

/** Known flags and their value types. Extend it here (one key per feature lane); empty until the first feature lane adds one. */
export interface FlagRegistry { 'provider.claude_code': boolean; 'provider.codex': boolean; 'provider.command_post.subscription': boolean }

/** Declare one flag: its key, type and the safe default used when the server never answered, left it out or sent the wrong type. */
export function defineFlag<K extends string, T extends FlagValue>(key: K, def: { type: TypeOf<T>; default: T }): FlagDef<T> {
  if (!FLAG_KEY_RE.test(key)) throw new TypeError(`flag key "${key}" must match ${FLAG_KEY_RE}`);
  if (typeof def.default !== def.type || (def.type === 'number' && !Number.isFinite(def.default))) throw new TypeError(`flag "${key}": the default is not a ${def.type}`);
  return Object.freeze({ key, type: def.type, default: def.default });
}

/** Every flag's definition, keyed like FlagRegistry. */
export type FlagDefs<R> = { readonly [K in keyof R]: R[K] extends FlagValue ? FlagDef<R[K]> : never };
export const FLAG_DEFS: FlagDefs<FlagRegistry> = Object.freeze({
  'provider.claude_code': defineFlag('provider.claude_code', { type: 'boolean', default: true }),
  'provider.codex': defineFlag('provider.codex', { type: 'boolean', default: true }),
  'provider.command_post.subscription': defineFlag('provider.command_post.subscription', { type: 'boolean', default: false }),
});

/** The value if it has the flag's type, else undefined (the caller falls back to the default). */
export function typed<T extends FlagValue>(def: FlagDef<T>, v: unknown): T | undefined {
  if (typeof v !== def.type) return undefined;
  if (def.type === 'number' && !Number.isFinite(v as number)) return undefined;
  return v as T;
}
