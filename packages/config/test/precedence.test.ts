import { join, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SCHEMA, get, loadConfig, memFs, type FlatFlags, type Key, type KeySpec, type LoadDeps } from '../src/index.js';

const P = (...s: string[]) => join(sep, ...s); const HOME = P('home', 'u'); const USER = join(HOME, '.config', 'centcom', 'config.json'); const REPO = P('work', 'repo'); const PROJ = join(REPO, '.centcom', 'config.json');
const deps = (files: Record<string, string>, env: Record<string, string> = {}): LoadDeps => ({ cwd: REPO, env, platform: 'linux', homedir: HOME, fs: memFs({ [join(REPO, '.git', 'HEAD')]: 'x', ...files }), warn: () => undefined });
const nest = (key: string, v: unknown) => { const [a, b] = key.split('.') as [string, string]; return JSON.stringify({ [a]: { [b]: v } }); };
/** A value that is valid for the key and differs from `not` (and from the default unless asked). */
function other(spec: KeySpec, not: unknown[]): string | number | boolean {
  const pool: (string | number | boolean)[] = spec.kind === 'boolean' ? [true, false] : spec.kind === 'enum' ? [...spec.enum!] : spec.kind === 'number' ? [spec.min ?? 1, (spec.min ?? 1) + 1, (spec.min ?? 1) + 2, (spec.min ?? 1) + 3, (spec.min ?? 1) + 4] : ['https://a.example', 'https://b.example', 'https://c.example', 'https://d.example', 'https://e.example'];
  const v = pool.find((x) => !not.includes(x)); if (v === undefined) throw new Error('no free value'); return v;
}
const KEYS = Object.keys(SCHEMA) as Key[];

/** Lane C004: the order flag > env > project > user > default holds for every key of the table, not only the ones the earlier tests chose. */
describe('precedence for every key', () => {
  it.each(KEYS)('%s: user beats default; project beats user (only where a project may set it)', async (key) => {
    const spec = SCHEMA[key] as KeySpec; const u = other(spec, [spec.default]); const p = other(spec, [u]); // two-valued keys have no third value: the project one may equal the default
    expect(get(await loadConfig(deps({})), key)).toBe(spec.default);
    expect(get(await loadConfig(deps({ [USER]: nest(key, u) })), key)).toBe(u);
    expect(get(await loadConfig(deps({ [USER]: nest(key, u), [PROJ]: nest(key, p) })), key)).toBe(spec.project ? p : u);
  });
  it.each(KEYS)('%s: a flag beats user, project and default', async (key) => {
    const spec = SCHEMA[key] as KeySpec; const u = other(spec, [spec.default]); const f = other(spec, [u]);
    expect(get(await loadConfig(deps({ [USER]: nest(key, u) }), { [key]: f } as FlatFlags), key)).toBe(f);
  });
  it('a project file cannot set keys that are not marked as project keys, and the user value stays', async () => {
    const closed = KEYS.filter((k) => !(SCHEMA[k] as KeySpec).project); expect(closed.length).toBeGreaterThan(5);
    for (const key of closed) { const spec = SCHEMA[key] as KeySpec; const u = other(spec, [spec.default]); const p = other(spec, [u]); expect(get(await loadConfig(deps({ [USER]: nest(key, u), [PROJ]: nest(key, p) })), key), key).toBe(u); }
  });
});

describe('the short environment names (lane C004)', () => {
  const cases: [string, string, Key, string | boolean][] = [
    ['CENTO_THEME', 'light', 'ui.theme', 'light'], ['CENTO_THEME', 'HC', 'ui.theme', 'hc'], ['CENTO_SPINNER', 'plain', 'ui.spinner', 'plain'], ['CENTO_MASCOT', 'off', 'ui.mascot', false], ['CENTO_MASCOT', 'on', 'ui.mascot', true],
    ['CENTO_REDUCE_MOTION', '1', 'ui.reduced_motion', true], ['CENTO_SCREEN_READER', 'yes', 'a11y.screen_reader', true], ['CENTCOM_LOG_LEVEL', 'DEBUG', 'log.level', 'debug'], ['NO_COLOR', '1', 'ui.color', 'never'],
  ];
  it.each(cases)('%s=%s sets %s', async (name, raw, key, want) => { expect(get(await loadConfig(deps({}, { [name]: raw })), key)).toBe(want); });
  it.each(cases.filter((c) => c[2] !== 'ui.color'))('%s beats the user file and a flag beats it', async (name, raw, key, want) => {
    const spec = SCHEMA[key] as KeySpec; const u = other(spec, [want]); const f = other(spec, [u]); if (f === want) return;
    expect(get(await loadConfig(deps({ [USER]: nest(key, u) }, { [name]: raw })), key)).toBe(want); expect(get(await loadConfig(deps({ [USER]: nest(key, u) }, { [name]: raw }), { [key]: f } as FlatFlags), key)).toBe(f);
  });
  it('a value that is not understood is ignored with a warning, never an error', async () => {
    const w: [string, string?][] = []; const d = { ...deps({}, { CENTO_THEME: 'neon', CENTO_MASCOT: 'maybe', CENTO_REDUCE_MOTION: '2' }), warn: (c: string, k?: string) => w.push([c, k]) } as LoadDeps; const c = await loadConfig(d);
    expect(get(c, 'ui.theme')).toBe('auto'); expect(get(c, 'ui.mascot')).toBe(true); expect(w.map((x) => x[1]).sort()).toEqual(['CENTO_MASCOT', 'CENTO_REDUCE_MOTION', 'CENTO_THEME']);
  });
  it('session.persist and session.retention_days have their defaults and limits', async () => {
    const c = await loadConfig(deps({})); expect(get(c, 'session.persist')).toBe(true); expect(get(c, 'session.retention_days')).toBe(30);
    const w: string[] = []; const d = { ...deps({ [USER]: JSON.stringify({ session: { retention_days: 0 } }) }), warn: (x: string) => w.push(x) } as LoadDeps; expect(get(await loadConfig(d), 'session.retention_days')).toBe(30); expect(w).toEqual(['user_config_ignored']);
    expect(get(await loadConfig(deps({ [USER]: JSON.stringify({ session: { persist: false, retention_days: 7 } }) })), 'session.retention_days')).toBe(7);
  });
  it('the per-turn limit is a number from 0 to 86400', async () => {
    expect(get(await loadConfig(deps({ [USER]: nest('agent.turn_timeout_s', 900) })), 'agent.turn_timeout_s')).toBe(900); expect(get(await loadConfig(deps({})), 'agent.turn_timeout_s')).toBe(0);
    const w: string[] = []; const d = { ...deps({ [USER]: JSON.stringify({ agent: { turn_timeout_s: 90000 }, ui: { theme: 'light' } }) }), warn: (c: string) => w.push(c) } as LoadDeps; const c = await loadConfig(d);
    expect(get(c, 'agent.turn_timeout_s')).toBe(0); expect(w).toEqual(['user_config_ignored']); // a value out of range ignores that file, with a warning (the known C004 behaviour), and never stops the start
  });
  it('a setting whose name contains "tokens" is not mistaken for a credential: the rest of the file is kept too', async () => {
    const w: string[] = []; const d = { ...deps({ [USER]: JSON.stringify({ context: { digest_tokens: 800 }, ui: { theme: 'light' } }) }), warn: (c: string) => w.push(c) } as LoadDeps; const c = await loadConfig(d);
    expect(get(c, 'context.digest_tokens')).toBe(800); expect(get(c, 'ui.theme')).toBe('light'); expect(w).toEqual([]);
    const bad = { ...deps({ [USER]: JSON.stringify({ client: { api_token: 'x' }, ui: { theme: 'light' } }) }), warn: (c: string) => w.push(c) } as LoadDeps; await loadConfig(bad); expect(w).toEqual(['user_config_ignored']); // a real credential key still voids the file
  });
});
