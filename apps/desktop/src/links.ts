/** `centcom://` links arrive from the operating system as a command-line argument (Windows, Linux) or an event (macOS). Only the documented forms are passed on to the page. */
import { parseDeepLink, type DeepLink } from '../../web/src/invite/deeplink.js';
export const PROTOCOL = 'centcom';
/** The first valid link among the arguments, or `undefined`. Everything else is ignored: an argument is only ever a candidate. */
export function linkFromArgv(argv: readonly string[]): { raw: string; link: DeepLink } | undefined { for (const a of argv) { if (typeof a !== 'string' || !a.startsWith(`${PROTOCOL}:`)) continue; const link = parseDeepLink(a); if (link) return { raw: a, link }; } return undefined; }
export { routeFor } from '../../web/src/invite/deeplink.js';
