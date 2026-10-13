// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { acceptInvite } from '../../src/invite/flow.js';
import { KeyHolder, decodeB64u } from '../../src/invite/fragment.js';
import { fragmentOf, setInviteHandoff, takeInviteHandoff } from '../../src/session/handoff.js';
import { fakeHttp } from '../workspace/helpers.js';

const T = 'AbCdEfGhIjKlMnOpQrStUvWxYz0'; const K = 'AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA';
describe('from the invite page to the session page (C083, C088: accept, then open the session)', () => {
  it('the key goes back to the same `#k=` fragment text for any length', () => {
    expect(fragmentOf(decodeB64u(K))).toBe(`#k=${K}`); for (const n of [1, 2, 3, 4, 31, 32, 33]) { const b = new Uint8Array(n).map((_, i) => (i * 37 + 5) & 255); const frag = fragmentOf(b); expect([...decodeB64u(frag.slice(3))]).toEqual([...b]); expect(frag).toMatch(/^#k=[A-Za-z0-9_-]+$/); }
  });
  it('a session invite is accepted, the key bundle is NOT fetched here (the session engine fetches it once), and the session and key are handed over in memory', async () => {
    const got: unknown[] = []; const key = new KeyHolder(decodeB64u(K)); const http = fakeHttp((c) => (c.op === 'acceptInvite' ? { session: 'ses_1', role: 'editor', workspace: 'wsp_1' } : {}));
    const r = await acceptInvite(http, T, { key, open: async () => { throw new Error('must not open'); }, sleep: async () => undefined, signedIn: true, handOff: (h) => got.push(h) });
    expect(r).toMatchObject({ state: 'joined', session: 'ses_1', keyed: true }); expect(http.calls.map((c) => c.op)).toEqual(['acceptInvite']); expect(got).toEqual([{ session: 'ses_1', token: T, secret: `#k=${K}` }]); expect(key.present).toBe(false);
  });
  it('a session invite without a key opens the session and waits for the host to let you in', async () => {
    const got: unknown[] = []; const http = fakeHttp(() => ({ session: 'ses_2', role: 'viewer', workspace: 'wsp_1' }));
    expect(await acceptInvite(http, T, { key: new KeyHolder(), open: async () => undefined, sleep: async () => undefined, signedIn: true, handOff: (h) => got.push(h) })).toMatchObject({ state: 'waiting_for_key', session: 'ses_2' }); expect(got).toEqual([{ session: 'ses_2', token: T }]);
  });
  it('the handoff is taken once (and the same render may ask twice within a moment), then it is gone; it is never in a URL or storage', () => {
    setInviteHandoff('ses_9', { token: T, secret: `#k=${K}` }); expect(takeInviteHandoff('ses_9', 1000)).toEqual({ token: T, secret: `#k=${K}` }); expect(takeInviteHandoff('ses_9', 2000)).toBeDefined(); expect(takeInviteHandoff('ses_9', 9000)).toBeUndefined(); expect(takeInviteHandoff('ses_other')).toBeUndefined();
    expect(JSON.stringify([window.location.href, { ...localStorage }, { ...sessionStorage }])).not.toContain(K);
  });
  it('a workspace invite (no session in the answer) keeps the old flow: the bundle is fetched once and opened', async () => {
    const opened: unknown[] = []; const http = fakeHttp((c) => (c.op === 'getInviteKeyBundle' ? { bundle: 'sealed' } : { workspace: { id: 'wsp_1' }, member: {} }));
    expect(await acceptInvite(http, T, { key: new KeyHolder(decodeB64u(K)), open: async (b) => { opened.push(b); }, sleep: async () => undefined, signedIn: true, handOff: () => { throw new Error('not for workspace invites'); } })).toMatchObject({ state: 'joined', keyed: true }); expect(opened).toEqual([{ bundle: 'sealed' }]);
  });
});
