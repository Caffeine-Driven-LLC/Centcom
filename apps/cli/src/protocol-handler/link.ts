/** `centcom link <centcom://…>`: what the operating system runs when a centcom:// link is opened (CT-DEEPLINK).
 *  It always asks first, never acts on its own, and an invalid link gets one neutral line that repeats nothing from the link.
 *  Exit codes: 0 handled, 1 could not open the browser, 2 invalid link (or not for the terminal), 3 declined. */
import { parseDeepLink, type DeepLink } from '../../../web/src/invite/deeplink.js';

export interface LinkIo { out(l: string): void; err(l: string): void; /** Ask a yes/no question; false when nobody can answer (no terminal). */ confirm(q: string): Promise<boolean>; /** Open an address in the browser; true when it was handed over. */ open(url: string): Promise<boolean> }
const WEB = 'https://centcom.dev';
const WHAT: Record<string, string> = { join: 'to join a session', invite: 'to accept a workspace invitation', share: 'to watch a shared session', session: 'to open a session', billing: 'to the billing page' };
/** The web page for a link. The `#k=` key fragment of a join link is kept (the page reads it locally and never sends it); anything else after `#` is dropped. */
export function webUrl(l: DeepLink, fragment = ''): string | undefined {
  const key = /^#k=[A-Za-z0-9_-]{16,128}$/.test(fragment) ? fragment : '';
  switch (l.kind) {
    case 'join': return `${WEB}/j/${l.token}${key}`; case 'invite': return `${WEB}/i/${l.token}${key}`; case 'share': return `${WEB}/g/${l.token}`;
    case 'session': return `${WEB}/s/${l.id}${l.focus ? `?focus=${l.focus}` : ''}`; case 'billing': return `${WEB}/billing`; default: return undefined;
  }
}
/** "y" or "yes", any case. */
export const isYes = (answer: string): boolean => /^y(es)?$/i.test(answer.trim());
export async function runLink(argv: string[], io: LinkIo): Promise<number> {
  if (argv.length !== 1 || argv[0]!.startsWith('-')) { io.err('Usage: centcom link <centcom://…>'); return 2; }
  const raw = argv[0]!; const link = parseDeepLink(raw);
  if (!link) { io.err('That link is not valid.'); return 2; }
  const what = WHAT[link.kind]; if (!what) { io.err('That link is for the Centcom desktop app.'); return 2; } // the sign-in callback is not a terminal matter
  if (!(await io.confirm(`This link is ${what}. Open it in your browser? [y/N] `))) { io.out('Nothing was opened.'); return 3; }
  let fragment = ''; try { fragment = new URL(raw.trim()).hash; } catch { /* parseDeepLink accepted it, so this does not happen */ }
  const url = webUrl(link, fragment)!;
  if (!(await io.open(url))) { io.err('Could not open your browser. Open the link again from where you found it, in your browser.'); return 1; }
  io.out('Opened in your browser.'); return 0;
}
/** How a URL is handed to the system, without a shell (so nothing in it is ever interpreted). */
export function openerFor(platform: NodeJS.Platform): { cmd: string; args(url: string): string[] } {
  if (platform === 'darwin') return { cmd: 'open', args: (u) => [u] };
  if (platform === 'win32') return { cmd: 'rundll32', args: (u) => ['url.dll,FileProtocolHandler', u] };
  return { cmd: 'xdg-open', args: (u) => [u] };
}
