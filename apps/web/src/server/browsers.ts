import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const CANDIDATES = [
  'chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable', 'brave', 'brave-browser', 'microsoft-edge', 'microsoft-edge-stable',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Applications/Chromium.app/Contents/MacOS/Chromium',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
];

function onPath(cmd: string): string | undefined {
  if (cmd.includes('/') || cmd.includes('\\')) return existsSync(cmd) ? cmd : undefined;
  for (const d of (process.env.PATH ?? '').split(process.platform === 'win32' ? ';' : ':')) { const p = join(d, cmd); if (existsSync(p)) return p; }
  return undefined;
}

export function findAppBrowser(): string | undefined { for (const c of CANDIDATES) { const p = onPath(c); if (p) return p; } return undefined; }

/** A chromeless window with its own profile: it behaves like an installed app (own taskbar entry, no tabs or address bar). */
export function openAsApp(url: string): boolean {
  const bin = findAppBrowser(); if (!bin) return false;
  const profile = join(homedir(), '.centcom', 'app-profile');
  spawn(bin, [`--app=${url}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--window-size=1280,860'], { detached: true, stdio: 'ignore' }).unref();
  return true;
}

export function openInBrowser(url: string): void {
  const [cmd, args]: [string, string[]] = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
  try { spawn(cmd, args, { detached: true, stdio: 'ignore' }).on('error', () => undefined).unref(); } catch { /* no opener available; the URL is printed anyway */ }
}
