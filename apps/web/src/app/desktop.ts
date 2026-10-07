import { parseDeepLink, routeFor } from '../invite/deeplink.js';

/** What the desktop app's preload offers the page (absent in a plain browser). */
export interface DesktopBridge { desktop: true; platform: string; onLink(cb: (url: string) => void): () => void; openExternal(url: string): Promise<boolean>; local?: { send(msg: unknown): void; onMessage(cb: (m: unknown) => void): () => void } }
declare global { interface Window { centcom?: DesktopBridge } }
export interface Nav { navigate(o: { to: string }): unknown }
/** A centcom:// link arrives from the system: sign-in links finish sign-in, the others open their screen. Anything that does not parse is dropped. */
export function handleLink(raw: string, o: { router: Nav; finishSignIn(url: URL): Promise<unknown> }): 'signin' | 'screen' | 'ignored' {
  const link = parseDeepLink(raw); if (!link) return 'ignored';
  if (link.kind === 'auth_callback') { void o.finishSignIn(new URL(raw)); return 'signin'; }
  const to = routeFor(link); if (!to) return 'ignored'; void o.router.navigate({ to }); return 'screen';
}
export function installDesktopBridge(o: { router: Nav; finishSignIn(url: URL): Promise<unknown> }, bridge: Pick<DesktopBridge, 'onLink'> | undefined = typeof window !== 'undefined' ? window.centcom : undefined): () => void { return bridge ? bridge.onLink((u) => void handleLink(u, o)) : () => undefined; }
