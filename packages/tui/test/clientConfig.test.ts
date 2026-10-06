import { describe, expect, it } from 'vitest';
import { DemoEngine } from '@centcom/agent';
import { memFs } from '@centcom/config';
import { AppController } from '../src/controller.js';
import { ClientConfig, settingsFromConfig } from '../src/clientConfig.js';
import { initialSettings } from '../src/state/model.js';

const USER = '/h/.config/centcom/config.json';
const load = (files: Record<string, string> = {}, flags = {}, env: Record<string, string> = {}) => { const fs = memFs({ '/p/.git/HEAD': 'x', ...files }); return ClientConfig.load('/p', flags, { fs, env, homedir: '/h', platform: 'linux' }).then((cc) => ({ cc, fs })); };
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
  it('starts with the saved history and reports each new message', async () => {
    const { cc, fs } = await load(); const seen: string[][] = [];
    const c = new AppController({ engine: new DemoEngine({ speed: 300 }), demo: true, cwd: '/p', version: 't', skills: [], ...cc.options(initialSettings()), history: ['older one', 'older two'], onHistory: (h) => seen.push(h) });
    expect(c.state.history).toEqual(['older one', 'older two']); await c.start(); c.setMode('bypassPermissions'); await c.submit('find where isExpired is used');
    expect(seen.at(-1)).toEqual(['older one', 'older two', 'find where isExpired is used']); c.stop(); void fs;
  });
  it('/config lists the settings in effect', async () => {
    const { cc } = await load({}, { 'client.model': 'opus' }); const c = new AppController({ engine: new DemoEngine({ speed: 300 }), demo: true, cwd: '/p', version: 't', skills: [], ...cc.options(initialSettings()) });
    await c.runCommand('/config'); const n = c.state.items.find((i) => i.kind === 'notice'); expect(n && n.kind === 'notice' && n.detail).toMatch(/client\.model\s+opus\s+flag/); c.stop();
  });
});
