/** The rules that keep the app window safe. Pure functions, so they are tested without Electron. */
import { isAbsolute, join, normalize, resolve, sep } from 'node:path';

export const APP_SCHEME = 'app'; export const APP_HOST = 'centcom'; export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;
/** The web preferences every window gets: no Node in the page, a sandbox, and isolation between the page and the preload. */
export const WEB_PREFERENCES = { contextIsolation: true, nodeIntegration: false, nodeIntegrationInWorker: false, nodeIntegrationInSubFrames: false, sandbox: true, webSecurity: true, allowRunningInsecureContent: false, webviewTag: false, spellcheck: false } as const;
/** The same policy the hosted pages use; the API and relay are the only other places the app talks to. */
export const CSP = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self' https://api.centcom.dev wss://relay.centcom.dev wss://relay-eu.centcom.dev wss://relay-us.centcom.dev; frame-ancestors 'none'; base-uri 'none'; object-src 'none'; form-action 'self'";
/** What the window may open inside itself: its own pages only. */
export const isAppUrl = (u: string): boolean => { try { const x = new URL(u); return x.protocol === `${APP_SCHEME}:` && x.hostname === APP_HOST && !x.username && !x.password && !x.port; } catch { return false; } };
/** What may be handed to the system browser: https, with no credentials in the address. */
export const isSafeExternal = (u: string): boolean => { try { const x = new URL(u); return x.protocol === 'https:' && !x.username && !x.password && x.hostname.length > 0; } catch { return false; } };
/** The sign-in page may also be on the configured API's own address when that is this computer (http on loopback), for development against a local backend. */
export const isSafeSignInUrl = (u: string, apiBase: string): boolean => {
  if (isSafeExternal(u)) return true;
  try { const x = new URL(u); const b = new URL(apiBase); const loop = (h: string) => h === 'localhost' || h === '127.0.0.1' || h === '[::1]'; return x.protocol === 'http:' && loop(x.hostname) && x.origin === b.origin && !x.username && !x.password; } catch { return false; }
};
/** `app://centcom/assets/x.js` to a file under `root`, or `undefined` for anything that would leave it. A path with no extension is a screen: it gets index.html (the app routes itself). */
export function appUrlToFile(u: string, root: string): string | undefined {
  if (!isAppUrl(u)) return undefined; const x = new URL(u); let p: string; try { p = decodeURIComponent(x.pathname); } catch { return undefined; } if (p.includes('\0') || p.includes('\\')) return undefined;
  const rel = p === '/' || !/\.[A-Za-z0-9]+$/.test(p) ? 'index.html' : p.replace(/^\/+/, ''); const base = resolve(root); const file = resolve(join(base, normalize(rel))); if (isAbsolute(rel) || !(file === base || file.startsWith(base + sep))) return undefined; return file;
}
const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff', '.wasm': 'application/wasm', '.txt': 'text/plain; charset=utf-8' };
export const mimeFor = (file: string): string => MIME[file.slice(file.lastIndexOf('.')).toLowerCase()] ?? 'application/octet-stream';
/** What the page may ask the system for, and only from the app's own address: notifications (an approval waits, push) and writing plain text to the clipboard (the copy buttons; the browser only honours it on a click). Reading the clipboard and everything else stay refused. */
const ALLOWED = new Set(['notifications', 'clipboard-sanitized-write']);
export const permissionAllowed = (permission: string, origin: string): boolean => ALLOWED.has(permission) && isAppUrl(origin);
/** The headers every response from the app address carries. */
export const responseHeaders = (file: string): Record<string, string> => ({ 'content-type': mimeFor(file), 'content-security-policy': CSP, 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff', 'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' });
