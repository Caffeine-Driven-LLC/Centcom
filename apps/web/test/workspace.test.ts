import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Workspace } from '../src/server/workspace.js';
import type { ServerMsg } from '../src/server/protocol.js';

let root: string; let saved: Record<string, string | undefined>;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'centcom-web-')); saved = { CENTCOM_CONFIG_DIR: process.env.CENTCOM_CONFIG_DIR, CENTCOM_STATE_DIR: process.env.CENTCOM_STATE_DIR };
  process.env.CENTCOM_CONFIG_DIR = join(root, 'cfg'); process.env.CENTCOM_STATE_DIR = join(root, 'state'); mkdirSync(join(root, 'cfg')); mkdirSync(join(root, 'proj', '.git'), { recursive: true });
});
afterEach(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } rmSync(root, { recursive: true, force: true }); });

describe('web workspace', () => {
  it('opens even when the user and project config files are bad, and shows notices without file contents', async () => {
    writeFileSync(join(root, 'cfg', 'config.json'), '{"ui": {"theme": BROKEN-VALUE}');
    mkdirSync(join(root, 'proj', '.centcom')); writeFileSync(join(root, 'proj', '.centcom', 'config.json'), JSON.stringify({ auth: { token: 'tok-abc-123' } }));
    const w = await Workspace.open(join(root, 'proj'), true); const got: ServerMsg[] = []; const leave = w.join((m) => got.push(m));
    const state = got.find((m) => m.t === 'state');
    const notices = JSON.stringify((state as Extract<ServerMsg, { t: 'state' }>).changed.filter((i) => i.kind === 'notice'));
    expect(notices).toContain('settings file was not used'); expect(notices).toContain('auth.token'); expect(notices).not.toContain('tok-abc-123'); expect(notices).not.toContain('BROKEN-VALUE');
    leave(); w.close();
  });
  it('keeps prompt history out of every state push, hands it over once, and does not save it in demo mode', async () => {
    const w = await Workspace.open(join(root, 'proj'), true); const got: ServerMsg[] = []; w.join((m) => got.push(m));
    w.ctl.setMode('bypassPermissions'); await w.ctl.submit('hello there'); for (let i = 0; i < 100 && got.length < 3; i++) await new Promise((r) => setTimeout(r, 20));
    const states = got.filter((m): m is Extract<ServerMsg, { t: 'state' }> => m.t === 'state'); expect(states.length).toBeGreaterThan(1);
    for (const s of states) expect(s.state).not.toHaveProperty('history');
    expect(w.history()).toEqual(['hello there']);
    w.close(); expect(existsSync(join(root, 'state', 'history.json'))).toBe(false);
  });
});
