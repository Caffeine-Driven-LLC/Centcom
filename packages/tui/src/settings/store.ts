/** The look-and-feel settings (theme, mascot, spinner, motion, density): one observable store, stored values under environment overrides. */
export type CentoColourName = 'violet' | 'red' | 'yellow' | 'green' | 'brown';
export interface UiSettings { theme: 'dark' | 'light' | 'auto' | 'hc'; mascot: 'on' | 'off'; mascotColor: CentoColourName; spinner: 'fun' | 'plain'; motion: 'full' | 'reduced'; density: 'comfortable' | 'compact' }
export type SettingKey = keyof UiSettings;
export type Source = 'default' | 'user config' | 'project config' | `env ${string}`;
export const DEFAULTS: UiSettings = { theme: 'dark', mascot: 'on', mascotColor: 'violet', spinner: 'fun', motion: 'full', density: 'comfortable' };
export const OPTIONS: { [K in SettingKey]: readonly UiSettings[K][] } = { theme: ['dark', 'light', 'auto', 'hc'], mascot: ['on', 'off'], mascotColor: ['violet', 'red', 'yellow', 'green', 'brown'], spinner: ['fun', 'plain'], motion: ['full', 'reduced'], density: ['comfortable', 'compact'] };
/** Which variable overrides which setting for the session. */
export const ENV_FOR: Partial<Record<SettingKey, string>> = { theme: 'CENTO_THEME', mascot: 'CENTO_MASCOT', spinner: 'CENTO_SPINNER', motion: 'CENTO_REDUCE_MOTION' };

/** The value an environment variable forces, or undefined (an unknown value is ignored). */
export function envValue<K extends SettingKey>(k: K, env: NodeJS.ProcessEnv): UiSettings[K] | undefined {
  const name = ENV_FOR[k]; const raw = name ? env[name] : undefined; if (!raw) return undefined; const v = raw.toLowerCase();
  if (k === 'motion') return (/^(1|true|on|yes)$/.test(v) ? 'reduced' : /^(0|false|off|no)$/.test(v) ? 'full' : undefined) as UiSettings[K] | undefined;
  if (k === 'mascot') return (v === 'on' || v === 'off' ? v : undefined) as UiSettings[K] | undefined;
  return ((OPTIONS[k] as readonly string[]).includes(v) ? v : undefined) as UiSettings[K] | undefined;
}
export interface SettingsDeps {
  stored: Partial<UiSettings>; sources?: Partial<Record<SettingKey, 'user config' | 'project config'>>; env: NodeJS.ProcessEnv;
  /** Writes one value to the user config (lane C004's writer). It may fail; the value then applies until quit. */ persist: (k: SettingKey, v: UiSettings[SettingKey]) => Promise<void>;
}
export interface SettingsStore {
  /** What is in effect now (environment overrides included). */ get(): UiSettings;
  /** What would be used without environment overrides. */ stored(): UiSettings;
  source(k: SettingKey): Source; overriddenBy(k: SettingKey): string | undefined;
  subscribe(fn: (s: UiSettings) => void): () => void;
  /** Applies at once and saves; rejects only with `SaveFailed` (the value stays applied). */ set<K extends SettingKey>(k: K, v: UiSettings[K]): Promise<void>;
}
export class SaveFailed extends Error { constructor() { super("Couldn't save this setting. It applies until you quit."); } }

export function createSettingsStore(d: SettingsDeps): SettingsStore {
  const kept: UiSettings = { ...DEFAULTS, ...d.stored }; const touched = new Set<SettingKey>(); const subs = new Set<(s: UiSettings) => void>();
  const effective = (): UiSettings => { const out = { ...kept }; for (const k of Object.keys(out) as SettingKey[]) { const e = envValue(k, d.env); if (e !== undefined) (out as Record<string, unknown>)[k] = e; } return out; };
  return {
    get: effective, stored: () => ({ ...kept }),
    overriddenBy: (k) => (envValue(k, d.env) !== undefined ? ENV_FOR[k] : undefined),
    source(k) { const e = this.overriddenBy(k); if (e) return `env ${e}`; if (touched.has(k)) return 'user config'; return d.sources?.[k] ?? (d.stored[k] !== undefined ? 'user config' : 'default'); },
    subscribe(fn) { subs.add(fn); return () => { subs.delete(fn); }; },
    async set(k, v) {
      (kept as unknown as Record<string, unknown>)[k] = v; touched.add(k); const now = effective(); for (const f of subs) f(now);
      try { await d.persist(k, v); } catch { throw new SaveFailed(); }
    },
  };
}
