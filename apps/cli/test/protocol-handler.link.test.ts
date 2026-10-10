import { describe, expect, it } from 'vitest';
import { openerFor, runLink, webUrl } from '../src/protocol-handler/link.js';

const TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWxYz0'; const KEY = 'AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA';
function rig(answer: boolean, opens = true) {
  const out: string[] = []; const err: string[] = []; const asked: string[] = []; const opened: string[] = [];
  return { out, err, asked, opened, io: { out: (l: string) => out.push(l), err: (l: string) => err.push(l), confirm: async (q: string) => { asked.push(q); return answer; }, open: async (u: string) => { opened.push(u); return opens; } } };
}
describe('centcom link', () => {
  it('asks first, then opens the matching web page; the key fragment of a join link is kept, other fragments are dropped', async () => {
    const cases: [string, string][] = [
      [`centcom://join/${TOKEN}#k=${KEY}`, `https://centcom.dev/j/${TOKEN}#k=${KEY}`], [`centcom://join/${TOKEN}#other=1`, `https://centcom.dev/j/${TOKEN}`], [`centcom://invite/${TOKEN}`, `https://centcom.dev/i/${TOKEN}`],
      [`centcom://share/${TOKEN}#k=${KEY}`, `https://centcom.dev/g/${TOKEN}`], ['centcom://session/ses_01JTEST000000000000000000A?focus=approval', 'https://centcom.dev/s/ses_01JTEST000000000000000000A?focus=approval'], ['centcom://billing', 'https://centcom.dev/billing'],
      [`https://centcom.dev/j/${TOKEN}`, `https://centcom.dev/j/${TOKEN}`],
    ];
    for (const [link, url] of cases) { const r = rig(true); expect(await runLink([link], r.io)).toBe(0); expect(r.asked).toHaveLength(1); expect(r.opened).toEqual([url]); expect(r.out).toEqual(['Opened in your browser.']); }
  });
  it('declining opens nothing and exits 3; the question never repeats the link (it says only what kind of link it is)', async () => {
    const r = rig(false); expect(await runLink([`centcom://join/${TOKEN}#k=${KEY}`], r.io)).toBe(3); expect(r.opened).toEqual([]); expect(r.asked).toEqual(['This link is to join a session. Open it in your browser? [y/N] ']); expect(r.asked.join()).not.toContain(TOKEN);
  });
  it('an invalid link is one neutral line with nothing from the link, and exits 2 without asking or opening', async () => {
    for (const bad of ['centcom://foo', 'centcom://join/short', `centcom://join/${TOKEN}/extra`, 'javascript:alert(1)', 'https://evil.example/j/' + TOKEN, `centcom://join/${TOKEN}; rm -rf /`, 'centcom://user:pw@join/' + TOKEN, '', 'x'.repeat(700), `centcom://join/${TOKEN}\nHost: evil`]) {
      const r = rig(true); expect(await runLink([bad], r.io)).toBe(2); expect(r.asked).toEqual([]); expect(r.opened).toEqual([]); expect(r.err).toEqual(['That link is not valid.']); expect(r.out).toEqual([]);
    }
  });
  it('the sign-in callback is not a terminal matter; the wrong number of arguments or an option is a usage error', async () => {
    const a = rig(true); expect(await runLink(['centcom://auth/callback?code=abcdefgh123&state=abcdefgh456'], a.io)).toBe(2); expect(a.err).toEqual(['That link is for the Centcom desktop app.']); expect(a.asked).toEqual([]);
    for (const argv of [[], ['a', 'b'], ['--help']]) { const r = rig(true); expect(await runLink(argv, r.io)).toBe(2); expect(r.err[0]).toMatch(/^Usage: centcom link/); }
  });
  it('when the browser cannot be opened it says so, without the link, and exits 1', async () => { const r = rig(true, false); expect(await runLink([`centcom://invite/${TOKEN}`], r.io)).toBe(1); expect(r.err.join()).not.toContain(TOKEN); expect(r.err[0]).toMatch(/Could not open your browser/); });
  it('web addresses and openers: no shell is involved, the URL is one argument', () => {
    expect(webUrl({ kind: 'auth_callback', code: 'x', state: 'y' })).toBeUndefined(); expect(webUrl({ kind: 'join', token: TOKEN }, `#k=${'a'.repeat(200)}`)).toBe(`https://centcom.dev/j/${TOKEN}`);
    expect(openerFor('linux')).toMatchObject({ cmd: 'xdg-open' }); expect(openerFor('darwin').args('u')).toEqual(['u']); expect(openerFor('win32')).toMatchObject({ cmd: 'rundll32' }); expect(openerFor('win32').args('https://centcom.dev/x?a=1&b=2')).toEqual(['url.dll,FileProtocolHandler', 'https://centcom.dev/x?a=1&b=2']);
  });
});
