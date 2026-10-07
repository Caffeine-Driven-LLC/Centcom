import { describe, expect, it, vi } from 'vitest';
import { handleLink, installDesktopBridge } from '../../src/app/desktop.js';
import { startLogin } from '../../src/auth/login.js';
import { deps } from '../auth/helpers.js';
import { loginEnv } from '../auth/helpers.js';

const T = 'AbCdEfGhIjKlMnOpQrStUvWxYz0'; const SES = 'ses_01JA3Z8K2M5N7P9Q0R1S2T3V4W';
describe('links in the desktop app', () => {
  const mk = () => { const nav: string[] = []; const done: URL[] = []; return { nav, done, o: { router: { navigate: (x: { to: string }) => void nav.push(x.to) }, finishSignIn: async (u: URL) => void done.push(u) } }; };
  it('a link opens its screen, a sign-in link finishes sign-in, junk is dropped', () => { const m = mk(); expect(handleLink(`centcom://join/${T}`, m.o)).toBe('screen'); expect(handleLink(`centcom://session/${SES}?focus=queue`, m.o)).toBe('screen'); expect(handleLink('centcom://billing', m.o)).toBe('screen'); expect(handleLink('centcom://auth/callback?code=abcdefgh12&state=abcdefgh34', m.o)).toBe('signin'); expect(handleLink('javascript:alert(1)', m.o)).toBe('ignored'); expect(handleLink('centcom://nonsense', m.o)).toBe('ignored'); expect(m.nav).toEqual([`/j/${T}`, `/s/${SES}?focus=queue`, '/billing']); expect(m.done).toHaveLength(1); expect(m.done[0]!.searchParams.get('state')).toBe('abcdefgh34'); });
  it('the bridge listens when the app is the desktop one and does nothing in a browser', () => { const m = mk(); let cb: (u: string) => void = () => undefined; const off = vi.fn(); const stop = installDesktopBridge(m.o, { onLink: (f) => { cb = f; return off; } }); cb(`centcom://invite/${T}`); expect(m.nav).toEqual([`/i/${T}`]); stop(); expect(off).toHaveBeenCalled(); expect(installDesktopBridge(m.o, undefined)()).toBeUndefined(); });
  it('desktop sign-in sends the browser away through the system with the centcom:// return address', async () => { const le = loginEnv(); const opened: string[] = []; const d = deps(async () => new Response('{}')); const url = await startLogin(d, { ...le.env, redirectUri: 'centcom://auth/callback', open: (u) => void opened.push(u) }); expect(opened).toEqual([url]); expect(le.calls).toEqual([]); expect(new URL(url).searchParams.get('redirect_uri')).toBe('centcom://auth/callback'); });
});
