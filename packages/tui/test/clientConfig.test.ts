import { join, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DemoEngine } from '@centcom/agent';
import { memFs } from '@centcom/config';
import { AppController } from '../src/controller.js';
import { ClientConfig, settingsFromConfig } from '../src/clientConfig.js';
import { initialSettings } from '../src/state/model.js';

// paths are built with node:path so the tests also pass on Windows
const P = (...s: string[]) => join(sep, ...s);
const HOME = P('h'); const PROJ_DIR = P('p'); const USER = join(HOME, '.config', 'centcom', 'config.json'); const PROJ_FILE = join(PROJ_DIR, '.centcom', 'config.json');
const load = (files: Record<string, string> = {}, flags = {}, env: Record<string, string> = {}) => { const fs = memFs({ [join(PROJ_DIR, '.git', 'HEAD')]: 'x', ...files }); return ClientConfig.load(PROJ_DIR, flags, { fs, env, homedir: HOME, platform: 'linux' }).then((cc) => ({ cc, fs })); };
const saveHistoryFor = (cc: ClientConfig, h: string[]) => cc.options(initialSettings()).onHistory!(h);
const saved = (fs: ReturnType<typeof memFs>) => JSON.parse(fs.files.get(USER) ?? '{}');

describe('what the client starts with', () => {
  it('uses your saved choices, and explicit flags beat them', async () => {
    const files = { [USER]: JSON.stringify({ client: { model: 'opus', cento_color: 'green', permission_mode: 'plan' }, ui: { theme: 'light', reduced_motion: true } }) };
    const a = settingsFromConfig((await load(files)).cc.cfg); expect(a).toMatchObject({ model: 'opus', color: 'green', permissionMode: 'plan', theme: 'light', reducedMotion: true });
    const b = settingsFromConfig((await load(files, { 'client.model': 'haiku', 'ui.theme': 'dark' })).cc.cfg); expect(b).toMatchObject({ model: 'haiku', theme: 'dark', color: 'green' });
  });
  it('hides Cento when the mascot is off, and follows the system as dark in a terminal', async () => {
    const s = settingsFromConfig((await load({ [USER]: JSON.stringify({ ui: { mascot: false } }) })).cc.cfg); expect(s.mascot).toBe('off'); expect(settingsFromConfig((await load()).cc.cfg).theme).toBe('dark');
  });
});

describe('a bad config file does not stop the client', () => {
  it('falls back to defaults for the user file and shows a readable warning without file contents', async () => {
    const { cc } = await load({ [USER]: '{"client": {"model": "SECRET-LOOKING-TEXT" oops' });
    expect(cc.cfg.client.model).toBe(''); expect(cc.warnings.join('\n')).toMatch(/settings file was not used/); expect(cc.warnings.join('\n')).not.toContain('SECRET-LOOKING-TEXT');
  });
  it('ignores a bad project file, and a secret key in it, naming only the key', async () => {
    const { cc } = await load({ [PROJ_FILE]: JSON.stringify({ client: { model: 'x' }, auth: { token: 'tok-123' } }) });
    expect(cc.cfg.client.model).toBe(''); const w = cc.warnings.join('\n'); expect(w).toMatch(/\.centcom\/config\.json was ignored/); expect(w).toContain('auth.token'); expect(w).not.toContain('tok-123');
  });
  it('notices when the project file selects the model', async () => {
    const { cc } = await load({ [PROJ_FILE]: JSON.stringify({ client: { model: 'opus' } }) }); expect(cc.cfg.client.model).toBe('opus'); expect(cc.warnings.join('\n')).toMatch(/selects the model "opus"/);
  });
  it('does not overwrite an unparseable user file when a setting changes, and says so', async () => {
    const { cc, fs } = await load({ [USER]: '{typo' }); cc.set('ui.theme', 'light'); cc.flush();
    expect(fs.files.get(USER)).toBe('{typo'); expect(cc.warnings.join('\n')).toMatch(/could not save settings/);
  });
});

describe('the mouse setting', () => {
  it('is on by default, read from ui.mouse, and remembered when you turn it off', async () => {
    expect(settingsFromConfig((await load()).cc.cfg).mouse).toBe(true);
    expect(settingsFromConfig((await load({ [USER]: JSON.stringify({ ui: { mouse: false } }) })).cc.cfg).mouse).toBe(false);
    const { cc, fs } = await load(); const base = { ...initialSettings(), ...settingsFromConfig(cc.cfg) }; cc.options(base);
    cc.remember({ ...base, mouse: false }); cc.flush(); expect(saved(fs)).toEqual({ ui: { mouse: false } });
  });
});

describe('what the client remembers', () => {
  it('saves only what you changed, not the defaults or your flags', async () => {
    const { cc, fs } = await load({}, { 'client.model': 'haiku' }); const base = { ...initialSettings(), ...settingsFromConfig(cc.cfg) }; cc.options(base);
    cc.remember(base); cc.flush(); expect(fs.files.has(USER)).toBe(false); // nothing changed, nothing written
    cc.remember({ ...base, color: 'red', autoSkills: false }); cc.flush(); expect(saved(fs)).toEqual({ client: { cento_color: 'red', auto_skills: false } }); // the --model flag was not stored
    cc.remember({ ...base, color: 'red', autoSkills: false, model: 'opus' }); cc.flush(); expect(saved(fs).client.model).toBe('opus');
  });
  it('never remembers skip-permissions, but does remember the normal modes', async () => {
    const { cc, fs } = await load(); const base = { ...initialSettings(), ...settingsFromConfig(cc.cfg) }; cc.options(base);
    cc.remember({ ...base, permissionMode: 'bypassPermissions' }); cc.flush(); expect(fs.files.has(USER)).toBe(false);
    cc.remember({ ...base, permissionMode: 'acceptEdits' }); cc.flush(); expect(saved(fs).client.permission_mode).toBe('acceptEdits');
  });
  it('remembers the fleet panel only after you change it', async () => {
    const { cc, fs } = await load(); const base = { ...initialSettings(), ...settingsFromConfig(cc.cfg) }; cc.options(base);
    cc.remember(base, true); cc.flush(); expect(fs.files.has(USER)).toBe(false); cc.remember(base, false); cc.flush(); expect(saved(fs).client.fleet_panel).toBe(false);
  });
  it('explains where values come from', async () => {
    const { cc } = await load({ [USER]: JSON.stringify({ client: { model: 'opus' } }) }, { 'ui.theme': 'light' });
    const d = cc.describe(); expect(d).toMatch(/client\.model\s+opus\s+user/); expect(d).toMatch(/ui\.theme\s+light\s+flag/); expect(d).not.toMatch(/api\.base_url/);
  });
});

describe('reading back what was just saved', () => {
  it('returns the new value straight away, before the file is even written', async () => {
    const { cc } = await load(); expect(cc.get('ui.theme')).toBe('auto'); cc.set('ui.theme', 'light'); cc.set('client.side_panel', false); expect(cc.get('ui.theme')).toBe('light'); expect(cc.get('client.side_panel')).toBe(false); expect(cc.get('client.model')).toBe('');
  });
});

describe('prompt history across sessions', () => {
  it('is neither read nor saved when history is switched off (--no-save, demo)', async () => {
    const { cc, fs } = await load(); saveHistoryFor(cc, ['kept']);
    const off = cc.options(initialSettings(), { saveHistory: false }); expect(off.history).toBeUndefined(); expect(off.onHistory).toBeUndefined();
    const before = fs.files.get(join(HOME, '.centcom', 'history.json')); const on = cc.options(initialSettings()); on.onHistory!(['more']); expect(fs.files.get(join(HOME, '.centcom', 'history.json'))).not.toBe(before); expect(on.history).toEqual(['kept']);
  });
  it('starts with the saved history and reports each new message', async () => {
    const { cc, fs } = await load(); const seen: string[][] = [];
    const c = new AppController({ engine: new DemoEngine({ speed: 300 }), demo: true, cwd: PROJ_DIR, version: 't', skills: [], ...cc.options(initialSettings()), history: ['older one', 'older two'], onHistory: (h) => seen.push(h) });
    expect(c.state.history).toEqual(['older one', 'older two']); await c.start(); c.setMode('bypassPermissions'); await c.submit('find where isExpired is used');
    expect(seen.at(-1)).toEqual(['older one', 'older two', 'find where isExpired is used']); c.stop(); void fs;
  });
  it('/config lists the settings in effect', async () => {
    const { cc } = await load({}, { 'client.model': 'opus' }); const c = new AppController({ engine: new DemoEngine({ speed: 300 }), demo: true, cwd: PROJ_DIR, version: 't', skills: [], ...cc.options(initialSettings()) });
    await c.runCommand('/config'); const n = c.state.items.find((i) => i.kind === 'notice'); expect(n && n.kind === 'notice' && n.detail).toMatch(/client\.model\s+opus\s+flag/); c.stop();
  });
});
