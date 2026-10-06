import { join, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigError, explain, get, jsonErrorPos, loadConfig, loadHistory, memFs, projectConfigPath, saveHistory, userConfigPath, writeUserConfig, type LoadDeps } from '../src/index.js';

// every path is built with node:path so the tests also pass on Windows (join gives backslashes there)
const P = (...s: string[]) => join(sep, ...s);
const HOME = P('home', 'u'); const USER = join(HOME, '.config', 'centcom', 'config.json');
const REPO = P('work', 'repo'); const SUB = join(REPO, 'sub'); const PROJ = join(REPO, '.centcom', 'config.json');
const deps = (files: Record<string, string> = {}, env: Record<string, string> = {}, cwd = SUB, warnings: [string, string?][] = [], fsOpts = {}): LoadDeps & { fs: ReturnType<typeof memFs>; warnings: [string, string?][] } => ({ cwd, env, platform: 'linux', homedir: HOME, fs: memFs({ [join(REPO, '.git', 'HEAD')]: 'x', ...files }, fsOpts), warn: (c, k) => warnings.push([c, k]), warnings });
const json = (o: unknown) => JSON.stringify(o);

describe('precedence: flag > env > project > user > default', () => {
  const files = { [USER]: json({ log: { level: 'warn' } }), [PROJ]: json({ log: { level: 'error' } }) };
  it('walks down the layers as each is removed', async () => {
    expect(get(await loadConfig(deps(files, { CENTCOM_LOG_LEVEL: 'debug' }), { 'log.level': 'silent' }), 'log.level')).toBe('silent');
    expect(get(await loadConfig(deps(files, { CENTCOM_LOG_LEVEL: 'debug' })), 'log.level')).toBe('debug');
    expect(get(await loadConfig(deps(files)), 'log.level')).toBe('error');
    expect(get(await loadConfig(deps({ [USER]: files[USER]! })), 'log.level')).toBe('warn');
    expect(get(await loadConfig(deps()), 'log.level')).toBe('info');
  });
  it('can say where each value came from', async () => {
    const c = await loadConfig(deps(files, { CENTCOM_LOG_LEVEL: 'debug' }));
    expect(explain(c, 'log.level')).toEqual({ layer: 'env', source: undefined }); expect(explain(c, 'net.max_attempts')).toEqual({ layer: 'default' });
    expect(explain(await loadConfig(deps(files)), 'log.level')).toEqual({ layer: 'project', source: PROJ });
  });
  it('deep-merges: a later layer overrides only its own keys', async () => {
    const c = await loadConfig(deps({ [USER]: json({ ui: { theme: 'dark', mascot: false } }), [PROJ]: json({ ui: { theme: 'light' } }) }));
    expect(c.ui).toMatchObject({ theme: 'light', mascot: false });
  });
});

describe('a cloned project cannot redirect or phone home', () => {
  it('ignores api/relay/telemetry from a project file, warns once, keeps allowed keys', async () => {
    const w: [string, string?][] = []; const c = await loadConfig(deps({ [PROJ]: json({ api: { base_url: 'https://evil.example' }, ui: { mascot: false } }) }, {}, REPO, w));
    expect(c.api.base_url).toBe('https://api.centcom.dev'); expect(c.ui.mascot).toBe(false); expect(w.filter(([code]) => code === 'project_key_ignored')).toEqual([['project_key_ignored', 'api.base_url']]);
  });
  it('never lets a project choose the permission mode', async () => {
    const w: [string, string?][] = []; const c = await loadConfig(deps({ [PROJ]: json({ client: { permission_mode: 'acceptEdits', model: 'opus' } }) }, {}, REPO, w));
    expect(c.client.permission_mode).toBe('default'); expect(c.client.model).toBe('opus'); expect(w).toContainEqual(['project_key_ignored', 'client.permission_mode']);
  });
  it('does not read a project file above the git toplevel', async () => {
    const d = deps({ [join(P('work'), '.centcom', 'config.json')]: json({ ui: { mascot: false } }) }, {}, SUB); expect(projectConfigPath(d)).toBeUndefined(); expect((await loadConfig(d)).ui.mascot).toBe(true);
  });
  it('finds the nearest project file inside the repo', () => { expect(projectConfigPath(deps({ [join(SUB, '.centcom', 'config.json')]: '{}' }))).toBe(join(SUB, '.centcom', 'config.json')); });
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
    const w: [string, string?][] = []; const c = await loadConfig(deps({}, { CENTCOM_LOG_LEVEL: 'loud' }, REPO, w)); expect(c.log.level).toBe('info'); expect(w).toContainEqual(['invalid_env', 'CENTCOM_LOG_LEVEL']);
  });
});

describe('a bad config file never stops Centcom', () => {
  const run = async (files: Record<string, string>, fsOpts = {}) => { const w: [string, string?][] = []; const c = await loadConfig(deps(files, {}, REPO, w, fsOpts)); return { c, w }; };
  it('a user file that is not valid JSON falls back to defaults and warns with file, line and column', async () => {
    const { c, w } = await run({ [USER]: '{\n  "ui": {\n    "theme": dark }\n}' });
    expect(c.ui.theme).toBe('auto'); const m = w.find(([code]) => code === 'user_config_ignored')![1]!; expect(m).toContain(USER); expect(m).toMatch(/line 3, column 14/); expect(m).not.toContain('dark');
  });
  it('a bad project file is ignored while the user file still applies', async () => {
    const { c, w } = await run({ [USER]: json({ ui: { theme: 'light' } }), [PROJ]: json({ log: { level: 'loud' } }) });
    expect(c.ui.theme).toBe('light'); expect(c.log.level).toBe('info'); expect(w).toContainEqual(['project_config_ignored', expect.stringContaining('log.level')]);
    const bad = await run({ [PROJ]: '{nope' }); expect(bad.c.log.level).toBe('info'); expect(bad.w.map(([code]) => code)).toContain('project_config_ignored');
  });
  it('a secret-looking key ignores that layer and names the key but never the value', async () => {
    for (const [file, code] of [[USER, 'user_config_ignored'], [PROJ, 'project_config_ignored']] as const) {
      const { c, w } = await run({ [file]: json({ ui: { theme: 'light' }, auth: { api_key: 'sk-super-secret-value' } }) });
      expect(c.ui.theme).toBe('auto'); const m = w.find(([k]) => k === code)![1]!; expect(m).toContain('auth.api_key'); expect(JSON.stringify(w)).not.toContain('sk-super-secret-value');
    }
  });
  it('an unreadable file is ignored too', async () => {
    const { c, w } = await run({ [USER]: '{}' }, { unreadable: [USER] }); expect(c.ui.theme).toBe('auto'); expect(w).toContainEqual(['user_config_ignored', expect.stringContaining(USER)]);
  });
  it('wrong types and out-of-range numbers are ignored with a warning, and unknown keys only warn', async () => {
    expect((await run({ [USER]: json({ net: { timeout_ms: 'fast' } }) })).w.map(([c]) => c)).toContain('user_config_ignored');
    const r = await run({ [USER]: json({ net: { max_attempts: 9999 } }) }); expect(r.c.net.max_attempts).toBe(5); expect(r.w.map(([c]) => c)).toContain('user_config_ignored');
    const w: [string, string?][] = []; await loadConfig(deps({ [USER]: json({ future: { thing: 1 } }) }, {}, REPO, w)); expect(w).toContainEqual(['unknown_key', 'future.thing']);
  });
  it('tells you when the project file picks the model, but not when you did', async () => {
    const f = { [PROJ]: json({ client: { model: 'opus' } }) };
    expect((await run(f)).w).toContainEqual(['project_sets_model', 'opus']);
    const w: [string, string?][] = []; await loadConfig(deps(f, {}, REPO, w), { 'client.model': 'haiku' }); expect(w.map(([c]) => c)).not.toContain('project_sets_model');
    expect((await run({ [USER]: json({ client: { model: 'opus' } }) })).w.map(([c]) => c)).not.toContain('project_sets_model');
  });
  it('accepts both spellings of the reduced-motion variable', async () => {
    for (const name of ['CENTCOM_REDUCE_MOTION', 'CENTCOM_REDUCED_MOTION']) expect((await loadConfig(deps({}, { [name]: '1' }))).ui.reduced_motion).toBe(true);
    expect((await loadConfig(deps({ [USER]: json({ ui: { reduced_motion: true } }) }, { CENTCOM_REDUCE_MOTION: '0' }))).ui.reduced_motion).toBe(false);
  });
});

describe('where a project file may be found', () => {
  const noGit = (files: Record<string, string>, cwd: string, env: Record<string, string> = {}) => ({ cwd, env, homedir: HOME, fs: memFs(files) });
  const J = (...s: string[]) => join(...s);
  it('outside a git repo it stops below the home folder', () => {
    const proj = J(HOME, 'proj'); const f = { [J(proj, '.centcom', 'config.json')]: '{}', [J(HOME, '.centcom', 'config.json')]: '{}' };
    expect(projectConfigPath(noGit(f, J(proj, 'a', 'b')))).toBe(J(proj, '.centcom', 'config.json'));
    expect(projectConfigPath(noGit({ [J(HOME, '.centcom', 'config.json')]: '{}' }, J(proj, 'a')))).toBeUndefined();
    expect(projectConfigPath(noGit({ [J(HOME, '.centcom', 'config.json')]: '{}' }, HOME))).toBeUndefined();
  });
  it('outside the home folder (and any repo) it only looks at the folder itself, never /tmp or above', () => {
    const f = { [J(P('tmp'), '.centcom', 'config.json')]: '{}' };
    expect(projectConfigPath(noGit(f, J(P('tmp'), 'x', 'y')))).toBeUndefined();
    expect(projectConfigPath(noGit(f, P('tmp')))).toBe(J(P('tmp'), '.centcom', 'config.json'));
  });
  it('never accepts the state dir config as a project file', () => {
    const state = P('somewhere', 'state'); const f = { [J(state, 'config.json')]: '{}' };
    expect(projectConfigPath(noGit(f, state, { CENTCOM_STATE_DIR: state }))).toBeUndefined();
    const named = P('opt', '.centcom'); expect(projectConfigPath(noGit({ [J(named, 'config.json')]: '{}' }, P('opt'), { CENTCOM_STATE_DIR: named }))).toBeUndefined();
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
    const d = deps({ [USER]: json({ ui: { theme: 'dark' } }) }, {}, REPO, [], { failRename: true });
    expect(() => writeUserConfig(d, { ui: { theme: 'light' } })).toThrow(); expect(JSON.parse(d.fs.files.get(USER)!)).toEqual({ ui: { theme: 'dark' } });
  });
  it('refuses to overwrite a user file it cannot parse or read, and warns instead', () => {
    for (const bad of ['{oops', '[1,2]', '"x"']) {
      const w: [string, string?][] = []; const d = deps({ [USER]: bad }, {}, SUB, w);
      expect(() => writeUserConfig(d, { ui: { theme: 'light' } })).toThrow(ConfigError); expect(d.fs.files.get(USER)).toBe(bad); expect(w).toContainEqual(['user_config_not_saved', USER]);
    }
    const w: [string, string?][] = []; const d = deps({ [USER]: '{}' }, {}, SUB, w, { unreadable: [USER] });
    expect(() => writeUserConfig(d, { ui: { theme: 'light' } })).toThrow(/cannot read/); expect(d.fs.files.get(USER)).toBe('{}');
    const ok = deps(); writeUserConfig(ok, { ui: { theme: 'light' } }); expect(JSON.parse(ok.fs.files.get(USER)!)).toEqual({ ui: { theme: 'light' } }); // a missing file is fine
  });
  it('can never store skip-permissions, secrets or unknown keys', () => {
    const d = deps();
    expect(() => writeUserConfig(d, { client: { permission_mode: 'bypassPermissions' } })).toThrow(ConfigError);
    expect(() => writeUserConfig(d, { auth: { token: 'x' } })).toThrow(ConfigError); expect(() => writeUserConfig(d, { nope: { thing: 1 } })).toThrow(ConfigError);
  });
  it('picks the right folder per platform and honors CENTCOM_CONFIG_DIR', () => {
    const h = P('h'); const x = P('x'); const c = P('c');
    expect(userConfigPath({ env: {}, platform: 'linux', homedir: h })).toBe(join(h, '.config', 'centcom', 'config.json'));
    expect(userConfigPath({ env: { XDG_CONFIG_HOME: x }, platform: 'linux', homedir: h })).toBe(join(x, 'centcom', 'config.json'));
    expect(userConfigPath({ env: {}, platform: 'darwin', homedir: h })).toBe(join(h, 'Library', 'Application Support', 'centcom', 'config.json'));
    expect(userConfigPath({ env: { CENTCOM_CONFIG_DIR: c }, platform: 'win32', homedir: h })).toBe(join(c, 'config.json'));
  });
  it('loads quickly with every layer present', async () => {
    const d = deps({ [USER]: json({ ui: { theme: 'dark' } }), [PROJ]: json({ ui: { mascot: false } }) }, { CENTCOM_LOG_LEVEL: 'debug' });
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
    const d = deps({ [join(HOME, '.centcom', 'history.json')]: '{oops' }); expect(loadHistory(d, '/p')).toEqual([]);
    saveHistory(d, '/p', ['ok', 'x'.repeat(30000)]); expect(loadHistory(d, '/p')).toEqual(['ok']);
  });
});
