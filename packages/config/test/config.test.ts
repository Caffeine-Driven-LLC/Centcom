import { describe, expect, it } from 'vitest';
import { ConfigError, explain, get, jsonErrorPos, loadConfig, loadHistory, memFs, projectConfigPath, saveHistory, userConfigPath, writeUserConfig, type LoadDeps } from '../src/index.js';

const HOME = '/home/u'; const USER = `${HOME}/.config/centcom/config.json`;
const deps = (files: Record<string, string> = {}, env: Record<string, string> = {}, cwd = '/work/repo/sub', warnings: [string, string?][] = [], fsOpts = {}): LoadDeps & { fs: ReturnType<typeof memFs>; warnings: [string, string?][] } => ({ cwd, env, platform: 'linux', homedir: HOME, fs: memFs({ '/work/repo/.git/HEAD': 'x', ...files }, fsOpts), warn: (c, k) => warnings.push([c, k]), warnings });
const json = (o: unknown) => JSON.stringify(o);

describe('precedence: flag > env > project > user > default', () => {
  const files = { [USER]: json({ log: { level: 'warn' } }), '/work/repo/.centcom/config.json': json({ log: { level: 'error' } }) };
  it('walks down the layers as each is removed', async () => {
    expect(get(await loadConfig(deps(files, { CENTCOM_LOG_LEVEL: 'debug' }), { 'log.level': 'silent' }), 'log.level')).toBe('silent');
    expect(get(await loadConfig(deps(files, { CENTCOM_LOG_LEVEL: 'debug' })), 'log.level')).toBe('debug');
    expect(get(await loadConfig(deps(files)), 'log.level')).toBe('error');
    expect(get(await loadConfig(deps({ [USER]: files[USER] })), 'log.level')).toBe('warn');
    expect(get(await loadConfig(deps()), 'log.level')).toBe('info');
  });
  it('can say where each value came from', async () => {
    const c = await loadConfig(deps(files, { CENTCOM_LOG_LEVEL: 'debug' }));
    expect(explain(c, 'log.level')).toEqual({ layer: 'env', source: undefined }); expect(explain(c, 'net.max_attempts')).toEqual({ layer: 'default' });
    expect(explain(await loadConfig(deps(files)), 'log.level')).toEqual({ layer: 'project', source: '/work/repo/.centcom/config.json' });
  });
  it('deep-merges: a later layer overrides only its own keys', async () => {
    const c = await loadConfig(deps({ [USER]: json({ ui: { theme: 'dark', mascot: false } }), '/work/repo/.centcom/config.json': json({ ui: { theme: 'light' } }) }));
    expect(c.ui).toMatchObject({ theme: 'light', mascot: false });
  });
});

describe('a cloned project cannot redirect or phone home', () => {
  it('ignores api/relay/telemetry from a project file, warns once, keeps allowed keys', async () => {
    const w: [string, string?][] = []; const c = await loadConfig(deps({ '/work/repo/.centcom/config.json': json({ api: { base_url: 'https://evil.example' }, ui: { mascot: false } }) }, {}, '/work/repo', w));
    expect(c.api.base_url).toBe('https://api.centcom.dev'); expect(c.ui.mascot).toBe(false); expect(w.filter(([code]) => code === 'project_key_ignored')).toEqual([['project_key_ignored', 'api.base_url']]);
  });
  it('never lets a project choose the permission mode', async () => {
    const w: [string, string?][] = []; const c = await loadConfig(deps({ '/work/repo/.centcom/config.json': json({ client: { permission_mode: 'acceptEdits', model: 'opus' } }) }, {}, '/work/repo', w));
    expect(c.client.permission_mode).toBe('default'); expect(c.client.model).toBe('opus'); expect(w).toContainEqual(['project_key_ignored', 'client.permission_mode']);
  });
  it('does not read a project file above the git toplevel', async () => {
    const d = deps({ '/work/.centcom/config.json': json({ ui: { mascot: false } }) }, {}, '/work/repo/sub'); expect(projectConfigPath(d)).toBeUndefined(); expect((await loadConfig(d)).ui.mascot).toBe(true);
  });
  it('finds the nearest project file inside the repo', () => { expect(projectConfigPath(deps({ '/work/repo/sub/.centcom/config.json': '{}' }))).toBe('/work/repo/sub/.centcom/config.json'); });
});

describe('environment and privacy', () => {
  it('maps the documented variables', async () => {
    const c = await loadConfig(deps({}, { CENTCOM_API_URL: 'https://x.test', CENTCOM_REDUCED_MOTION: '1', NO_COLOR: '1', CENTCOM_RELAY_URL: 'wss://r.test' }));
    expect(c.api.base_url).toBe('https://x.test'); expect(c.ui.reduced_motion).toBe(true); expect(c.ui.color).toBe('never'); expect(c.relay.url).toBe('wss://r.test');
  });
  it('DO_NOT_TRACK and CENTCOM_TELEMETRY=off force telemetry off even if a file and a flag say on', async () => {
    const f = { [USER]: json({ telemetry: { enabled: true } }) };
    expect((await loadConfig(deps(f, { DO_NOT_TRACK: '1' }), { 'telemetry.enabled': true })).telemetry.enabled).toBe(false);
    expect((await loadConfig(deps(f, { CENTCOM_TELEMETRY: 'off' }), { 'telemetry.enabled': true })).telemetry.enabled).toBe(false);
    expect((await loadConfig(deps(f))).telemetry.enabled).toBe(true); expect((await loadConfig(deps())).telemetry.enabled).toBe(false);
  });
  it('warns and ignores a bad environment value instead of crashing', async () => {
    const w: [string, string?][] = []; const c = await loadConfig(deps({}, { CENTCOM_LOG_LEVEL: 'loud' }, '/work/repo', w)); expect(c.log.level).toBe('info'); expect(w).toContainEqual(['invalid_env', 'CENTCOM_LOG_LEVEL']);
  });
});

describe('files that are wrong are explained, not crashed on', () => {
  it('refuses a secret and names the key but never the value', async () => {
    const err = await loadConfig(deps({ [USER]: json({ auth: { api_key: 'sk-super-secret-value' } }) })).catch((e) => e) as ConfigError;
    expect(err).toBeInstanceOf(ConfigError); expect(err.kind).toBe('secret_in_file'); expect(err.key).toBe('auth.api_key'); expect(err.message).not.toContain('sk-super-secret-value');
  });
  it('reports bad JSON with file, line and column', async () => {
    const err = await loadConfig(deps({ [USER]: '{\n  "ui": {\n    "theme": dark }\n}' })).catch((e) => e) as ConfigError;
    expect(err.kind).toBe('parse'); expect(err.message).toContain(USER); expect(err.message).toMatch(/line 3, column 14/);
  });
  it('reports an unreadable file', async () => { const err = await loadConfig(deps({ [USER]: '{}' }, {}, '/work/repo', [], { unreadable: [USER] })).catch((e) => e) as ConfigError; expect(err.kind).toBe('unreadable'); expect(err.path).toBe(USER); });
  it('rejects wrong types and out-of-range numbers, and warns on unknown keys', async () => {
    expect((await loadConfig(deps({ [USER]: json({ net: { timeout_ms: 'fast' } }) })).catch((e) => e) as ConfigError).kind).toBe('invalid_value');
    expect((await loadConfig(deps({ [USER]: json({ net: { max_attempts: 9999 } }) })).catch((e) => e) as ConfigError).kind).toBe('invalid_value');
    const w: [string, string?][] = []; await loadConfig(deps({ [USER]: json({ future: { thing: 1 } }) }, {}, '/work/repo', w)); expect(w).toContainEqual(['unknown_key', 'future.thing']);
  });
});

describe('JSON error locator', () => {
  it('finds the first bad character, and accepts valid documents', () => {
    expect(jsonErrorPos('{"a": [1, 2, {"b": null}], "c": "x\\"y", "d": -1.5e3}')).toBe(-1);
    expect(jsonErrorPos('{"a": 1,}')).toBe(8); expect(jsonErrorPos('{"a" 1}')).toBe(5); expect(jsonErrorPos('[1, 2')).toBe(5); expect(jsonErrorPos('{"a": tru}')).toBe(6); expect(jsonErrorPos('')).toBeGreaterThanOrEqual(0);
  });
});

describe('writing', () => {
  it('writes atomically with mode 0600, merging into what is there and keeping other keys', () => {
    const d = deps({ [USER]: json({ ui: { theme: 'dark' }, log: { level: 'warn' } }) });
    writeUserConfig(d, { client: { model: 'opus' }, ui: { theme: 'light' } });
    expect(JSON.parse(d.fs.files.get(USER)!)).toEqual({ ui: { theme: 'light' }, log: { level: 'warn' }, client: { model: 'opus' } }); expect(d.fs.modes.get(USER)).toBe(0o600);
    writeUserConfig(d, { client: { model: undefined } }); expect(JSON.parse(d.fs.files.get(USER)!).client).toEqual({});
  });
  it('leaves the original intact when the rename fails (a crash mid-write)', () => {
    const d = deps({ [USER]: json({ ui: { theme: 'dark' } }) }, {}, '/work/repo', [], { failRename: true });
    expect(() => writeUserConfig(d, { ui: { theme: 'light' } })).toThrow(); expect(JSON.parse(d.fs.files.get(USER)!)).toEqual({ ui: { theme: 'dark' } });
  });
  it('can never store skip-permissions, secrets or unknown keys', () => {
    const d = deps();
    expect(() => writeUserConfig(d, { client: { permission_mode: 'bypassPermissions' } })).toThrow(ConfigError);
    expect(() => writeUserConfig(d, { auth: { token: 'x' } })).toThrow(ConfigError); expect(() => writeUserConfig(d, { nope: { thing: 1 } })).toThrow(ConfigError);
  });
  it('picks the right folder per platform and honors CENTCOM_CONFIG_DIR', () => {
    expect(userConfigPath({ env: {}, platform: 'linux', homedir: '/h' })).toBe('/h/.config/centcom/config.json');
    expect(userConfigPath({ env: { XDG_CONFIG_HOME: '/x' }, platform: 'linux', homedir: '/h' })).toBe('/x/centcom/config.json');
    expect(userConfigPath({ env: {}, platform: 'darwin', homedir: '/h' })).toBe('/h/Library/Application Support/centcom/config.json');
    expect(userConfigPath({ env: { CENTCOM_CONFIG_DIR: '/c' }, platform: 'win32', homedir: '/h' })).toBe('/c/config.json');
  });
  it('loads quickly with every layer present', async () => {
    const d = deps({ [USER]: json({ ui: { theme: 'dark' } }), '/work/repo/.centcom/config.json': json({ ui: { mascot: false } }) }, { CENTCOM_LOG_LEVEL: 'debug' });
    const t = performance.now(); await loadConfig(d, { 'ui.color': '256' }); expect(performance.now() - t).toBeLessThan(20);
  });
});

describe('prompt history', () => {
  it('is kept per project, capped, newest last, and survives a restart', () => {
    const d = deps(); const many = Array.from({ length: 260 }, (_, i) => `msg ${i}`);
    saveHistory(d, '/p1', many); saveHistory(d, '/p2', ['other']);
    const h = loadHistory(d, '/p1'); expect(h).toHaveLength(200); expect(h.at(-1)).toBe('msg 259'); expect(loadHistory(d, '/p2')).toEqual(['other']); expect(loadHistory(d, '/none')).toEqual([]);
  });
  it('drops absurdly long entries and tolerates a damaged file', () => {
    const d = deps({ [`${HOME}/.centcom/history.json`]: '{oops' }); expect(loadHistory(d, '/p')).toEqual([]);
    saveHistory(d, '/p', ['ok', 'x'.repeat(30000)]); expect(loadHistory(d, '/p')).toEqual(['ok']);
  });
});
