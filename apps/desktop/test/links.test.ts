import { describe, expect, it } from 'vitest';
import { PROTOCOL, linkFromArgv, routeFor } from '../src/links.js';

const T = 'AbCdEfGhIjKlMnOpQrStUvWxYz0'; const SES = 'ses_01JA3Z8K2M5N7P9Q0R1S2T3V4W';
describe('links from the system', () => {
  it('the first valid centcom link among the arguments wins; everything else is ignored', () => { expect(PROTOCOL).toBe('centcom'); expect(linkFromArgv(['/usr/bin/centcom', '--flag', `centcom://join/${T}`, `centcom://billing`])).toMatchObject({ raw: `centcom://join/${T}`, link: { kind: 'join', token: T } }); expect(linkFromArgv(['x', 'centcom://nonsense', `centcom://session/${SES}?focus=queue`])).toMatchObject({ link: { kind: 'session', id: SES, focus: 'queue' } }); for (const argv of [[], ['--inspect=0.0.0.0:9229', 'https://evil.example'], ['centcom://join/short'], ['centcom:evil'], [`http://centcom.dev/j/${T}`]]) expect(linkFromArgv(argv)).toBeUndefined(); });
  it('web addresses given as arguments are not links (only the centcom scheme comes from the system)', () => { expect(linkFromArgv([`https://centcom.dev/j/${T}`])).toBeUndefined(); });
  it('each link has its screen, and a sign-in callback has none', () => { const r = (u: string) => { const l = linkFromArgv([u]); return l ? routeFor(l.link) : 'none'; }; expect(r(`centcom://join/${T}`)).toBe(`/j/${T}`); expect(r(`centcom://invite/${T}`)).toBe(`/i/${T}`); expect(r(`centcom://share/${T}`)).toBe(`/g/${T}`); expect(r(`centcom://session/${SES}`)).toBe(`/s/${SES}`); expect(r(`centcom://session/${SES}?focus=approval`)).toBe(`/s/${SES}?focus=approval`); expect(r('centcom://billing')).toBe('/billing'); expect(r('centcom://auth/callback?code=abcdefgh12&state=abcdefgh34')).toBeUndefined(); });
});
