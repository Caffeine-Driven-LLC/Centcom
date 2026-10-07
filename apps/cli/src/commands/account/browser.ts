/** Opens the sign-in page in the default browser: xdg-open / open / cmd /c start, always with an argument array, never a shell string.
 *  Must not: open anything but https (or the configured loopback dev base URL); pass a URL with cmd metacharacters to cmd; wait more than 3 s. */
import { spawn as nodeSpawn, type SpawnOptions } from 'node:child_process';

const LOOPBACK = new Set(['127.0.0.1', '[::1]', 'localhost']);
/** Characters cmd.exe would act on even inside an argument. */
const CMD_META = /[&|<>^"%!()\s]/;
export const OPEN_TIMEOUT_MS = 3_000;

/** May this server-supplied URL be opened? https always; http only when it is the loopback dev base URL's origin. No credentials in it. */
export function isOpenableUrl(raw: string, devBaseUrl?: string): boolean {
  let u: URL; try { u = new URL(raw); } catch { return false; }
  if (u.username || u.password) return false;
  if (u.protocol === 'https:') return true;
  if (u.protocol !== 'http:' || !devBaseUrl) return false;
  try { const d = new URL(devBaseUrl); return d.protocol === 'http:' && LOOPBACK.has(d.hostname) && d.origin === u.origin; } catch { return false; }
}

/** The program and arguments that open a URL on this platform, or null when it cannot be done safely. */
export function openerCommand(url: string, platform: NodeJS.Platform): { file: string; args: string[] } | null {
  if (platform === 'darwin') return { file: 'open', args: [url] };
  if (platform === 'win32') return CMD_META.test(url) ? null : { file: 'cmd', args: ['/c', 'start', '""', url] };
  return { file: 'xdg-open', args: [url] };
}

type Spawn = (file: string, args: string[], o: SpawnOptions) => { once(ev: 'spawn' | 'error', fn: (e?: unknown) => void): unknown; unref(): void };

/** Try to open `url`. Resolves true once the opener started, false if it could not (no opener, refused URL, timeout). Never throws. */
export function createBrowserOpener(o: { platform?: NodeJS.Platform; spawn?: Spawn; devBaseUrl?: string } = {}): (url: string) => Promise<boolean> {
  const platform = o.platform ?? process.platform; const spawn = o.spawn ?? (nodeSpawn as unknown as Spawn);
  return (url) => new Promise<boolean>((resolve) => {
    if (!isOpenableUrl(url, o.devBaseUrl)) return resolve(false);
    const cmd = openerCommand(url, platform); if (!cmd) return resolve(false);
    let done = false; const finish = (v: boolean) => { if (!done) { done = true; clearTimeout(t); resolve(v); } };
    const t = setTimeout(() => finish(false), OPEN_TIMEOUT_MS);
    try {
      const p = spawn(cmd.file, cmd.args, { stdio: 'ignore', detached: true, shell: false, windowsHide: true, windowsVerbatimArguments: platform === 'win32' } /* the URL was checked to have no cmd metacharacters */);
      p.once('spawn', () => { p.unref(); finish(true); }); p.once('error', () => finish(false));
    } catch { finish(false); }
  });
}
