import { homedir as osHomedir } from 'node:os';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { type ConfigFs, nodeFs } from './fs.js';
import { KEYS, SCHEMA, SECRET_RE, type Key, type KeySpec } from './schema.js';

export type Layer = 'default' | 'user' | 'project' | 'env' | 'flag';
export type Value = string | number | boolean;
export type FlatFlags = Partial<Record<Key, Value>>;

export class ConfigError extends Error {
  constructor(public kind: 'invalid_value' | 'secret_in_file' | 'unreadable' | 'parse', message: string, public key?: string, public path?: string) { super(message); this.name = 'ConfigError'; }
}

export interface LoadDeps {
  cwd: string; env: Record<string, string | undefined>; platform: NodeJS.Platform; homedir: string; fs: ConfigFs;
  warn: (code: string, key?: string) => void;
}
export const defaultDeps = (over: Partial<LoadDeps> = {}): LoadDeps => ({ cwd: process.cwd(), env: process.env, platform: process.platform, homedir: osHomedir(), fs: nodeFs, warn: () => undefined, ...over });

/** Where the user's config file lives. $CENTCOM_CONFIG_DIR wins; otherwise the platform's usual place. */
export function userConfigPath(d: Pick<LoadDeps, 'env' | 'platform' | 'homedir'>): string {
  const e = d.env.CENTCOM_CONFIG_DIR; if (e) return join(e, 'config.json');
  if (d.platform === 'darwin') return join(d.homedir, 'Library', 'Application Support', 'centcom', 'config.json');
  if (d.platform === 'win32') return join(d.env.APPDATA ?? join(d.homedir, 'AppData', 'Roaming'), 'centcom', 'config.json');
  return join(d.env.XDG_CONFIG_HOME ?? join(d.homedir, '.config'), 'centcom', 'config.json');
}
/** Sessions, history, the web token and other state. Kept in ~/.centcom so earlier installs keep working. */
export function stateDir(d: Pick<LoadDeps, 'env' | 'homedir'>): string { return d.env.CENTCOM_STATE_DIR ?? join(d.homedir, '.centcom'); }

const inside = (root: string, dir: string): boolean => { const r = relative(root, dir); return r === '' || (!r.startsWith('..') && !isAbsolute(r)); };

/**
 * `.centcom/config.json` from the nearest folder up to (and never beyond) the git toplevel. Max 25 levels.
 * Outside a git repo the search stops below the home directory (never at or above it); a folder that is not under
 * the home directory only looks at itself. The state dir's own config.json is never a project file.
 */
export function projectConfigPath(d: Pick<LoadDeps, 'cwd' | 'fs'> & Partial<Pick<LoadDeps, 'homedir' | 'env'>>): string | undefined {
  const home = d.homedir; const state = home !== undefined ? stateDir({ env: d.env ?? {}, homedir: home }) : d.env?.CENTCOM_STATE_DIR;
  const stateCfg = state ? join(state, 'config.json') : undefined;
  const candidate = (dir: string) => { if (dir === home) return undefined; const p = join(dir, '.centcom', 'config.json'); return p !== stateCfg && d.fs.read(p) !== null ? p : undefined; };
  const gitRoot = (() => { let dir = d.cwd; for (let i = 0; i < 25; i++) { if (d.fs.exists(join(dir, '.git'))) return dir; const up = dirname(dir); if (up === dir) return undefined; dir = up; } return undefined; })();
  let dir = d.cwd;
  for (let i = 0; i < 25; i++) {
    const p = candidate(dir); if (p) return p;
    if (gitRoot !== undefined ? dir === gitRoot : (home === undefined || !inside(home, dir) || dirname(dir) === home || dir === home)) return undefined; // repo root, or the edge of what we trust outside a repo
    const up = dirname(dir); if (up === dir) return undefined; dir = up;
  }
  return undefined;
}

/* ------------------------------------------------------------------ files */
/** Index of the first character that makes `text` invalid JSON, or -1 if it parses. (Node's own error text has no position.) */
export function jsonErrorPos(text: string): number {
  let i = 0; const n = text.length; const ws = () => { while (i < n && ' \t\n\r'.includes(text[i]!)) i++; };
  const lit = (w: string) => { if (text.startsWith(w, i)) { i += w.length; return true; } return false; };
  function val(): boolean {
    ws(); const c = text[i];
    if (c === '{') { i++; ws(); if (text[i] === '}') { i++; return true; } for (;;) { ws(); if (text[i] !== '"' || !str()) return false; ws(); if (text[i++] !== ':') { i--; return false; } if (!val()) return false; ws(); if (text[i] === ',') { i++; continue; } if (text[i] === '}') { i++; return true; } return false; } }
    if (c === '[') { i++; ws(); if (text[i] === ']') { i++; return true; } for (;;) { if (!val()) return false; ws(); if (text[i] === ',') { i++; continue; } if (text[i] === ']') { i++; return true; } return false; } }
    if (c === '"') return str();
    if (lit('true') || lit('false') || lit('null')) return true;
    const m = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(text.slice(i)); if (m) { i += m[0].length; return true; }
    return false;
  }
  function str(): boolean { i++; while (i < n) { const c = text[i]; if (c === '"') { i++; return true; } if (c === '\\') i++; else if (c! < ' ') return false; i++; } return false; }
  const ok = val(); ws(); return ok && i === n ? -1 : i;
}


function flatten(obj: unknown, prefix = '', out: Record<string, unknown> = {}): Record<string, unknown> {
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out); else out[key] = v;
  }
  return out;
}

function coerce(spec: KeySpec, v: unknown): Value | undefined {
  switch (spec.kind) {
    case 'boolean': return typeof v === 'boolean' ? v : undefined;
    case 'number': return typeof v === 'number' && Number.isFinite(v) && v >= (spec.min ?? -Infinity) && v <= (spec.max ?? Infinity) ? v : undefined;
    case 'enum': return typeof v === 'string' && spec.enum!.includes(v) ? v : undefined;
    case 'string': return typeof v === 'string' ? v : undefined;
  }
}

function parseFile(d: LoadDeps, path: string, layer: 'user' | 'project'): Partial<Record<Key, Value>> {
  let text: string | null;
  try { text = d.fs.read(path); } catch (e) { throw new ConfigError('unreadable', `Cannot read ${path}: ${(e as NodeJS.ErrnoException).code ?? 'error'}`, undefined, path); }
  if (text === null || !text.trim()) return {};
  let json: unknown;
  try { json = JSON.parse(text); } catch (e) {
    const pos = jsonErrorPos(text); let loc = '';
    if (pos >= 0) { const before = text.slice(0, pos); loc = ` at line ${before.split('\n').length}, column ${before.length - before.lastIndexOf('\n')}`; }
    throw new ConfigError('parse', `${path} is not valid JSON${loc}`, undefined, path);
  }
  const flat = flatten(json); const out: Partial<Record<Key, Value>> = {};
  for (const [key, raw] of Object.entries(flat)) {
    if (SECRET_RE.test(key.split('.').pop()!) || SECRET_RE.test(key)) throw new ConfigError('secret_in_file', `${path} contains "${key}". Credentials do not belong in a config file; Centcom never reads them from here.`, key, path);
    const spec = (SCHEMA as Record<string, KeySpec>)[key];
    if (!spec) { d.warn('unknown_key', key); continue; }
    if (layer === 'project' && !spec.project) { d.warn('project_key_ignored', key); continue; }
    const val = coerce(spec, raw);
    if (val === undefined) throw new ConfigError('invalid_value', `${key} in ${path} must be ${spec.kind === 'enum' ? 'one of ' + spec.enum!.join(', ') : spec.kind === 'number' ? `a number between ${spec.min} and ${spec.max}` : 'a ' + spec.kind}`, key, path);
    out[key as Key] = val;
  }
  return out;
}

/* ------------------------------------------------------------------ env */
const ENV: [string, Key, (v: string) => Value | undefined][] = [
  ['CENTCOM_API_URL', 'api.base_url', (v) => v], ['CENTCOM_RELAY_URL', 'relay.url', (v) => v],
  ['CENTCOM_LOG_LEVEL', 'log.level', (v) => v.toLowerCase()],
  ['CENTCOM_REDUCE_MOTION', 'ui.reduced_motion', (v) => (/^(1|true|on|yes)$/i.test(v) ? true : /^(0|false|off|no)$/i.test(v) ? false : undefined)], // the older spelling still works; CENTCOM_REDUCED_MOTION below wins if both are set
  ['CENTCOM_REDUCED_MOTION', 'ui.reduced_motion', (v) => (/^(1|true|on|yes)$/i.test(v) ? true : /^(0|false|off|no)$/i.test(v) ? false : undefined)],
  /* the short CENTO_* names listed in `centcom help env` */
  ['CENTO_THEME', 'ui.theme', (v) => v.toLowerCase()], ['CENTO_SPINNER', 'ui.spinner', (v) => v.toLowerCase()],
  ['CENTO_MASCOT', 'ui.mascot', (v) => (/^(on|1|true|yes)$/i.test(v) ? true : /^(off|0|false|no)$/i.test(v) ? false : undefined)],
  ['CENTO_REDUCE_MOTION', 'ui.reduced_motion', (v) => (/^(1|true|on|yes)$/i.test(v) ? true : /^(0|false|off|no)$/i.test(v) ? false : undefined)],
  ['CENTO_SCREEN_READER', 'a11y.screen_reader', (v) => (/^(1|true|on|yes)$/i.test(v) ? true : /^(0|false|off|no)$/i.test(v) ? false : undefined)],
  ['NO_COLOR', 'ui.color', (v) => (v ? 'never' : undefined)],
];
function fromEnv(d: LoadDeps): Partial<Record<Key, Value>> {
  const out: Partial<Record<Key, Value>> = {};
  for (const [name, key, parse] of ENV) {
    const raw = d.env[name]; if (raw === undefined || raw === '') continue;
    const v = parse(raw); const ok = v !== undefined && coerce(SCHEMA[key] as KeySpec, v) !== undefined;
    if (ok) out[key] = v!; else d.warn('invalid_env', name);
  }
  const t = d.env.CENTCOM_TELEMETRY; if (t !== undefined && t !== '') { if (/^on$/i.test(t)) out['telemetry.enabled'] = true; else if (/^off$/i.test(t)) out['telemetry.enabled'] = false; else d.warn('invalid_env', 'CENTCOM_TELEMETRY'); }
  return out;
}

/* ------------------------------------------------------------------ resolve */
export type ResolvedConfig = Readonly<{ api: { base_url: string }; relay: { url: string }; net: { timeout_ms: number; max_attempts: number }; budget: { session_usd: number }; telemetry: { enabled: boolean }; log: { level: 'debug' | 'info' | 'warn' | 'error' | 'silent'; max_file_bytes: number; max_files: number }; ui: { theme: 'auto' | 'dark' | 'light' | 'hc'; mascot: boolean; mouse: boolean; spinner: 'fun' | 'plain'; density: 'comfortable' | 'compact'; reduced_motion: boolean; color: 'auto' | 'truecolor' | '256' | '16' | 'never' }; a11y: { screen_reader: boolean }; lan: { enabled: boolean }; agent: { max_parallel: number; approval_timeout_ms: number }; client: { engine: 'claude-code' | 'codex'; model: string; permission_mode: 'default' | 'acceptEdits' | 'plan'; cento_color: 'violet' | 'red' | 'yellow' | 'green' | 'brown'; mascot_size: 'auto' | 'large' | 'small' | 'off'; auto_skills: boolean; side_panel: boolean; fleet_panel: boolean }; [explainSym]?: never }>;
const explainSym = Symbol('centcom.config.sources');
type Sources = Map<Key, { layer: Layer; source?: string }>;

export async function loadConfig(d: LoadDeps, flags: FlatFlags = {}): Promise<ResolvedConfig> {
  const userPath = userConfigPath(d); const projPath = projectConfigPath(d);
  // A bad file must never stop Centcom: the user layer falls back to defaults, the project layer is ignored. The warning carries the file and key, never a value.
  const safely = (layer: 'user' | 'project', path: string): Partial<Record<Key, Value>> => {
    try { return parseFile(d, path, layer); } catch (e) {
      if (!(e instanceof ConfigError)) throw e;
      d.warn(layer === 'user' ? 'user_config_ignored' : 'project_config_ignored', e.message); return {};
    }
  };
  const layers: { layer: Layer; source?: string; values: Partial<Record<Key, Value>> }[] = [
    { layer: 'user', source: userPath, values: safely('user', userPath) },
    { layer: 'project', source: projPath, values: projPath ? safely('project', projPath) : {} },
    { layer: 'env', values: fromEnv(d) },
    { layer: 'flag', values: Object.fromEntries(Object.entries(flags).filter(([k, v]) => KEYS.includes(k as Key) && v !== undefined && coerce(SCHEMA[k as Key] as KeySpec, v) !== undefined)) as Partial<Record<Key, Value>> },
  ];
  const flat: Record<string, Value> = {}; const src: Sources = new Map();
  for (const k of KEYS) { flat[k] = SCHEMA[k].default; src.set(k, { layer: 'default' }); }
  for (const l of layers) for (const [k, v] of Object.entries(l.values) as [Key, Value][]) { flat[k] = v; src.set(k, { layer: l.layer, source: l.source }); }
  // privacy: these always turn telemetry off, whatever any file or flag says
  if (d.env.DO_NOT_TRACK && d.env.DO_NOT_TRACK !== '0' || /^off$/i.test(d.env.CENTCOM_TELEMETRY ?? '')) { flat['telemetry.enabled'] = false; src.set('telemetry.enabled', { layer: 'env' }); }
  if (src.get('client.model')?.layer === 'project') d.warn('project_sets_model', String(flat['client.model'])); // a cloned repo can pick a pricier model: say so
  const nested: Record<string, Record<string, Value>> = {};
  for (const [k, v] of Object.entries(flat)) { const [a, b] = k.split('.') as [string, string]; (nested[a] ??= {})[b] = v; }
  for (const o of Object.values(nested)) Object.freeze(o);
  Object.defineProperty(nested, explainSym, { value: src, enumerable: false });
  return Object.freeze(nested) as unknown as ResolvedConfig;
}

export function explain(cfg: ResolvedConfig, key: Key): { layer: Layer; source?: string } {
  const src = (cfg as unknown as Record<symbol, Sources>)[explainSym]; return src?.get(key) ?? { layer: 'default' };
}
export function get<K extends Key>(cfg: ResolvedConfig, key: K): Value { const [a, b] = key.split('.') as [string, string]; return (cfg as unknown as Record<string, Record<string, Value>>)[a]![b]!; }

/* ------------------------------------------------------------------ write */
type DeepPartial = Record<string, Record<string, Value | undefined>>;
/** Merge a patch into the user's file and write it atomically (0600). Unknown keys already in the file are kept. */
export function writeUserConfig(d: LoadDeps, patch: DeepPartial): void {
  const path = userConfigPath(d); let cur: Record<string, Record<string, unknown>> = {};
  // Never overwrite a file we cannot understand: the user's other settings would be lost.
  let t: string | null;
  try { t = d.fs.read(path); } catch (e) { d.warn('user_config_not_saved', path); throw new ConfigError('unreadable', `Settings not saved: cannot read ${path} (${(e as NodeJS.ErrnoException).code ?? 'error'}). Fix or remove it first.`, undefined, path); }
  if (t !== null && t.trim()) {
    let parsed: unknown;
    try { parsed = JSON.parse(t); } catch { d.warn('user_config_not_saved', path); throw new ConfigError('parse', `Settings not saved: ${path} is not valid JSON. Fix or remove it first.`, undefined, path); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) { d.warn('user_config_not_saved', path); throw new ConfigError('parse', `Settings not saved: ${path} is not a JSON object. Fix or remove it first.`, undefined, path); }
    cur = parsed as typeof cur;
  }
  for (const [sec, vals] of Object.entries(patch)) for (const [k, v] of Object.entries(vals)) {
    const key = `${sec}.${k}`; const spec = (SCHEMA as Record<string, KeySpec>)[key];
    if (SECRET_RE.test(key) || !spec) throw new ConfigError('invalid_value', `Unknown or forbidden setting "${key}"`, key);
    if (v === undefined) { if (cur[sec]) delete cur[sec]![k]; continue; }
    if (coerce(spec, v) === undefined) throw new ConfigError('invalid_value', `${key} has an invalid value`, key);
    (cur[sec] ??= {})[k] = v;
  }
  d.fs.writeAtomic(path, JSON.stringify(cur, null, 2) + '\n', 0o600);
}
