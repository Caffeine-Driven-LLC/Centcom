import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyPlan, desktopQuote, describe as describePlan, planInstall, planUninstall, runInstallHandler, type Action } from '../src/protocol-handler/handler.js';

const home = () => mkdtempSync(join(tmpdir(), 'cc-handler-'));
const env = (platform: NodeJS.Platform, h = '/home/u', exe = ['/usr/bin/node', '/opt/centcom/cli.mjs']) => ({ platform, home: h, exe });
function io(run?: (c: string, a: string[]) => Promise<number | 'missing'>) { const out: string[] = []; const err: string[] = []; const ran: string[] = []; return { out, err, ran, io: { out: (l: string) => out.push(l), err: (l: string) => err.push(l), run: async (c: string, a: string[]) => { ran.push([c, ...a].join(' ')); return run ? run(c, a) : 0; } } }; }

describe('the link handler plans', () => {
  it('Linux: a desktop entry that runs `centcom link %u` in a terminal (so it can ask), registered with xdg-mime, all inside the user\'s own folders', () => {
    const plan = planInstall(env('linux')); const w = plan.find((a) => a.kind === 'write') as Extract<Action, { kind: 'write' }>; expect(w.path).toBe('/home/u/.local/share/applications/centcom.desktop');
    expect(w.content.split('\n')).toEqual(expect.arrayContaining(['Type=Application', 'Exec=/usr/bin/node /opt/centcom/cli.mjs link %u', 'Terminal=true', 'NoDisplay=true', 'MimeType=x-scheme-handler/centcom;']));
    expect(plan.filter((a) => a.kind === 'run').map((a) => (a as { cmd: string }).cmd)).toEqual(['xdg-mime', 'update-desktop-database']); expect(JSON.stringify(plan)).not.toMatch(/sudo|\/usr\/share|\/etc\//);
  });
  it('a path with spaces or special characters is quoted so it stays one word', () => {
    expect(desktopQuote('/opt/My Apps/centcom')).toBe('"/opt/My Apps/centcom"'); expect(desktopQuote('/a/b"c')).toBe('"/a/b\\"c"'); expect(desktopQuote('/a/100%/c')).toBe('"/a/100%%/c"'); expect(desktopQuote('/usr/bin/node')).toBe('/usr/bin/node');
    const w = planInstall(env('linux', '/home/u', ['/opt/My Apps/centcom'])).find((a) => a.kind === 'write') as Extract<Action, { kind: 'write' }>; expect(w.content).toContain('Exec="/opt/My Apps/centcom" link %u');
  });
  it('Windows: three entries under the current user only, the link passed as "%1"', () => {
    const plan = planInstall(env('win32', 'C:\\Users\\u', ['C:\\Program Files\\Centcom\\centcom.exe'])); const cmds = plan.map((a) => (a as { args: string[] }).args); expect(cmds.every((a) => a[1]?.startsWith('HKCU\\Software\\Classes\\centcom'))).toBe(true);
    expect(cmds[2]).toEqual(['add', 'HKCU\\Software\\Classes\\centcom\\shell\\open\\command', '/ve', '/d', '"C:\\Program Files\\Centcom\\centcom.exe" link "%1"', '/f']); expect(planUninstall(env('win32'))).toEqual([{ kind: 'run', cmd: 'reg', args: ['delete', 'HKCU\\Software\\Classes\\centcom', '/f'] }]);
  });
  it('macOS: a small app in ~/Applications that opens Terminal with `centcom link <url>`, with the scheme declared and registered; uninstall removes the app', () => {
    const plan = planInstall(env('darwin')); const cmds = plan.filter((a) => a.kind === 'run') as Extract<Action, { kind: 'run' }>[]; expect(cmds.map((c) => c.cmd.split('/').pop())).toEqual(['osacompile', 'plutil', 'lsregister']);
    expect(cmds[0]!.args.join(' ')).toContain('quoted form of u'); expect(cmds[0]!.args[1]).toBe('/home/u/Applications/Centcom Link.app'); expect(cmds[1]!.args.join(' ')).toContain('<string>centcom</string>'); expect(planUninstall(env('darwin'))).toEqual([{ kind: 'remove', path: '/home/u/Applications/Centcom Link.app', recursive: true }]);
  });
  it('no plan puts a link, a token or a key into an entry', () => { for (const p of ['linux', 'darwin', 'win32'] as const) expect(JSON.stringify(planInstall(env(p)))).not.toMatch(/centcom:\/\/|token|#k=/i); });
});

describe('applying a plan', () => {
  it('install on Linux writes the entry and registers it; uninstall removes the entry and only our line from mimeapps.list', async () => {
    const h = home(); const e = env('linux', h); const a = io(); expect(await runInstallHandler([], e, a.io)).toBe(0); const f = join(h, '.local/share/applications/centcom.desktop'); expect(readFileSync(f, 'utf8')).toContain('MimeType=x-scheme-handler/centcom;');
    expect(statSync(f).mode & 0o777).toBe(0o644); expect(a.ran[0]).toBe('xdg-mime default centcom.desktop x-scheme-handler/centcom'); expect(a.out).toEqual(['centcom:// links now open with Centcom (it asks before doing anything).']);
    mkdirSync(join(h, '.config'), { recursive: true }); writeFileSync(join(h, '.config/mimeapps.list'), '[Default Applications]\nx-scheme-handler/centcom=centcom.desktop\ntext/html=firefox.desktop\n');
    const b = io(); expect(await runInstallHandler(['--uninstall'], e, b.io)).toBe(0); expect(existsSync(f)).toBe(false); expect(readFileSync(join(h, '.config/mimeapps.list'), 'utf8')).toBe('[Default Applications]\ntext/html=firefox.desktop\n'); expect(b.out).toEqual(['centcom:// links are no longer opened with Centcom.']);
    expect(await runInstallHandler(['--uninstall'], e, io().io)).toBe(0); // twice is fine
  });
  it('--dry-run lists what would be done and changes nothing; a bad option is a usage error', async () => {
    const h = home(); const a = io(); expect(await runInstallHandler(['--dry-run'], env('linux', h), a.io)).toBe(0); expect(a.out.join('\n')).toMatch(/write .*centcom\.desktop[\s\S]*run xdg-mime default centcom\.desktop/); expect(a.ran).toEqual([]); expect(existsSync(join(h, '.local'))).toBe(false);
    const b = io(); expect(await runInstallHandler(['--nope'], env('linux', h), b.io)).toBe(2); expect(b.err[0]).toMatch(/^Usage: centcom install-handler/);
    expect(describePlan(planInstall(env('win32')))[0]).toMatch(/^run reg add HKCU/);
  });
  it('a missing nice-to-have tool only warns (exit 0, manual steps shown); a missing required one stops with exit 1', async () => {
    const h = home(); const a = io(async (c) => (c === 'xdg-mime' ? 'missing' : 0)); expect(await runInstallHandler([], env('linux', h), a.io)).toBe(0); expect(a.err[0]).toMatch(/xdg-utils is not installed[\s\S]*centcom link %u/); expect(existsSync(join(h, '.local/share/applications/centcom.desktop'))).toBe(true);
    const b = io(async () => 1); expect(await runInstallHandler([], env('win32'), b.io)).toBe(1); expect(b.err).toEqual(['reg failed, so the link handler was not changed.']); expect(b.ran).toHaveLength(1); // stops at the first failure
  });
  it('a folder that cannot be written (a file is in the way) is reported, not thrown', async () => { const h = home(); const blocker = join(h, 'file'); writeFileSync(blocker, 'x'); const a = io(); expect(await applyPlan([{ kind: 'write', path: join(blocker, 'x'), content: 'x' }], a.io)).toBe(1); expect(a.err).toEqual(['Could not write the link handler files.']); });
  it('readdir sanity: install touches only the applications folder', async () => { const h = home(); await runInstallHandler([], env('linux', h), io().io); expect(readdirSync(join(h, '.local/share'))).toEqual(['applications']); expect(existsSync(join(h, '.config'))).toBe(false); });
});
