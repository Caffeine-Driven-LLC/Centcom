import { readFileSync, readdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bundle } from '../scripts/build.js';

const src = (f: string) => readFileSync(join(process.cwd(), 'apps/desktop/src', f), 'utf8');
describe('the main process (read as source: Electron itself is not started here)', () => {
  const main = src('main.ts');
  it('uses the hardened preferences, never loosens them, and has no remote content', () => { expect(main).toContain('...WEB_PREFERENCES'); expect(main).not.toMatch(/nodeIntegration:\s*true|contextIsolation:\s*false|webSecurity:\s*false|sandbox:\s*false|enableRemoteModule|allowRunningInsecureContent:\s*true|webviewTag:\s*true/); expect(main).not.toMatch(/loadURL\(\s*['"`]https?:/); expect(main).toContain('loadURL(`${APP_ORIGIN}/`)'); });
  it('opens new windows only in the system browser (https), blocks other navigation, answers permission requests by policy', () => { expect(main).toContain('setWindowOpenHandler'); expect(main).toContain("action: 'deny'"); expect(main).toContain('will-navigate'); expect(main).toContain('isSafeExternal'); expect(main).toContain('setPermissionRequestHandler'); expect(main).toContain('setPermissionCheckHandler'); expect(main).not.toMatch(/openExternal\((?!url)/); });
  it('runs once, takes links from the system on every platform, and serves only through the app scheme', () => { expect(main).toContain('requestSingleInstanceLock'); expect(main).toContain("'second-instance'"); expect(main).toContain("'open-url'"); expect(main).toContain('setAsDefaultProtocolClient'); expect(main).toMatch(/registerSchemesAsPrivileged\(\[\{ scheme: APP_SCHEME, privileges: \{ standard: true, secure: true, supportFetchAPI: true, stream: true \} \}\]\)/); expect(main).toContain('appUrlToFile(req.url, WEB_ROOT)'); });
  it('the preload exposes a small fixed surface: no Electron objects, no Node', () => { const p = src('preload.ts'); expect(p.match(/exposeInMainWorld\('centcom'/g)).toHaveLength(1); for (const name of ['desktop', 'platform', 'onLink', 'openExternal']) expect(p).toContain(name); expect(p).not.toMatch(/require\(|child_process|\bfs\b|ipcRenderer,?\s*\}\)|exposeInMainWorld\('[^c]/); expect(p).toContain("typeof url === 'string'"); });
});
describe('the bundle', () => {
  it('builds both files with Electron left out and nothing unsafe in them', async () => { const dir = mkdtempSync(join(tmpdir(), 'cc-desktop-')); const files = await bundle(join(process.cwd(), 'apps/desktop'), dir); expect(readdirSync(dir).sort()).toEqual(['main.mjs', 'preload.cjs']); const main = readFileSync(files[0]!, 'utf8'); expect(main).toMatch(/from ?"electron"/); expect(main).not.toMatch(/nodeIntegration:\s*(!0|true)/); expect(main.length).toBeLessThan(8_000_000); expect(readFileSync(files[1]!, 'utf8')).toContain('contextBridge');
    // library data files are found next to their sources, not next to the bundle
    expect(main).toContain('file://' ); expect(main).toMatch(/file:\/\/[^"]*packages\/tui\/src\/util\/verbs\.ts/); expect(main).not.toMatch(/new URL\([^)]*verbs\.txt[^)]*import\.meta\.url/);
  });
});
