/** Connects the layered config (files, env, flags) to the running client: what to start with, and what to remember. */
import { SCHEMA, defaultDeps, explain, get, loadConfig, loadHistory, saveHistory, writeUserConfig, KEYS, type Key, type LoadDeps, type ResolvedConfig, type FlatFlags } from '@centcom/config';
import type { ControllerOptions } from './controller.js';
import type { Settings } from './state/model.js';

/** controller setting -> config key. Only these are remembered, and only when they actually change. */
const REMEMBER: { [K in keyof Settings]?: (v: Settings[K]) => [Key, string | boolean] | null } = {
  theme: (v) => ['ui.theme', v],
  mascot: (v) => ['client.mascot_size', v],
  reducedMotion: (v) => ['ui.reduced_motion', v],
  mouse: (v) => ['ui.mouse', v],
  spinner: (v) => ['ui.spinner', v],
  color: (v) => ['client.cento_color', v],
  autoSkills: (v) => ['client.auto_skills', v],
  model: (v) => ['client.model', v],
  permissionMode: (v) => (v === 'bypassPermissions' ? null : ['client.permission_mode', v]), // skip-permissions is never remembered
};

export function settingsFromConfig(c: ResolvedConfig): Partial<Settings> {
  return {
    theme: c.ui.theme === 'light' ? 'light' : c.ui.theme === 'hc' ? 'hc' : 'dark', // the terminal cannot sense the system, so "auto" is dark there
    mascot: c.ui.mascot ? c.client.mascot_size : 'off', reducedMotion: c.ui.reduced_motion, color: c.client.cento_color,
    autoSkills: c.client.auto_skills, model: c.client.model, mouse: c.ui.mouse, spinner: c.ui.spinner, permissionMode: c.client.permission_mode,
  };
}

/** Plain-language text for a config warning. It only ever carries file paths, key names and the project's model id, never file contents. */
export function describeWarning(code: string, detail?: string): string {
  switch (code) {
    case 'user_config_ignored': return `your settings file was not used, defaults apply. ${detail ?? ''}`.trim();
    case 'project_config_ignored': return `this folder's .centcom/config.json was ignored. ${detail ?? ''}`.trim();
    case 'project_sets_model': return `this folder's .centcom/config.json selects the model "${detail ?? ''}" (change it with /model or --model)`;
    case 'user_config_not_saved': return `settings not saved: ${detail ?? 'your settings file'} could not be read or parsed, so it was left untouched`;
    default: return detail ? `${code}: ${detail}` : code;
  }
}

export class ClientConfig {
  readonly cfg!: ResolvedConfig; readonly warnings: string[] = []; private deps: LoadDeps; private saved: Settings | undefined; private timer?: NodeJS.Timeout; private pending: Record<string, Record<string, string | boolean>> = {};
  private constructor(deps: LoadDeps) { this.deps = deps; }

  /** Load config for a folder. `flags` are the explicit command-line choices (highest priority, never written back). */
  static async load(cwd: string, flags: FlatFlags = {}, over: Partial<LoadDeps> = {}): Promise<ClientConfig> {
    const warnings: string[] = []; const deps = defaultDeps({ cwd, warn: (code, key) => warnings.push(describeWarning(code, key)), ...over });
    const cc = new ClientConfig(deps); (cc as { cfg: ResolvedConfig }).cfg = await loadConfig(deps, flags); cc.warnings.push(...warnings); return cc;
  }

  /** Controller options that make a session start the way you left it and remember what you change. */
  options(initial: Settings, opts: { saveHistory?: boolean } = {}): Pick<ControllerOptions, 'history' | 'onHistory' | 'onPrefs' | 'describeConfig'> {
    this.saved = { ...initial };
    const keep = opts.saveHistory !== false; // --no-save and demo sessions neither read nor write prompt history
    return {
      history: keep ? loadHistory(this.deps, this.deps.cwd) : undefined,
      onHistory: keep ? (h) => { try { saveHistory(this.deps, this.deps.cwd, h); } catch { /* history is a convenience; never break the app over it */ } } : undefined,
      onPrefs: (p) => this.remember(p.settings, p.fleet),
      describeConfig: () => this.describe(),
    };
  }

  remember(s: Settings, fleet?: boolean) {
    const prev = this.saved ?? s;
    for (const k of Object.keys(REMEMBER) as (keyof Settings)[]) {
      if (s[k] === prev[k]) continue; const m = (REMEMBER[k] as (v: unknown) => [Key, string | boolean] | null)(s[k]); if (!m) continue;
      const [key, val] = m; const [a, b] = key.split('.') as [string, string]; (this.pending[a] ??= {})[b] = val;
    }
    this.saved = { ...s };
    if (fleet !== undefined && fleet !== this.lastFleet) { if (this.lastFleet !== undefined) (this.pending.client ??= {}).fleet_panel = fleet; this.lastFleet = fleet; }
    this.flushSoon();
  }
  private lastFleet?: boolean;
  /** Called when a later save fails (the launch-time warnings are in `warnings`). */
  onWarn?: (text: string) => void;
  /** Remember a single value now (used by the web server for panel and theme choices). */
  set(key: Key, value: string | boolean) { const [a, b] = key.split('.') as [string, string]; (this.pending[a] ??= {})[b] = value; this.live.set(key, value); this.flushSoon(); }
  /** Values saved during this run, so reading them back is never stale. */
  private live = new Map<Key, string | boolean>();
  private flushSoon() { if (this.timer) return; this.timer = setTimeout(() => { this.timer = undefined; this.flush(); }, 300); this.timer.unref?.(); }
  flush() {
    if (!Object.keys(this.pending).length) return; const patch = this.pending; this.pending = {};
    try { writeUserConfig(this.deps, patch); } catch (e) { this.warnings.push(`could not save settings: ${(e as Error).message}`); this.onWarn?.(this.warnings.at(-1)!); }
  }

  /** Human-readable "what is set, and where did it come from" for /config. */
  describe(): string {
    const rows = KEYS.filter((k) => !k.startsWith('api.') && !k.startsWith('relay.') && !k.startsWith('net.') && !k.startsWith('lan.') && !k.startsWith('telemetry.')).map((k) => { const e = explain(this.cfg, k); return `${k.padEnd(26)} ${String(get(this.cfg, k) === '' ? '(default)' : get(this.cfg, k)).padEnd(14)} ${e.layer}${e.source ? ' · ' + e.source : ''}`; });
    return rows.join('\n');
  }
  get<K extends Key>(k: K) { return this.live.get(k) ?? get(this.cfg, k); }
  specs() { return SCHEMA; }
}
