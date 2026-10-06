import { describe, expect, it } from 'vitest';
import { RelayError, checkRelayUrl, isPrivateHost } from '../../src/index.js';
import { rig } from './helpers.js';

/** [url, allowPlainWs, accepted] */
const MATRIX: [string, boolean, boolean][] = [
  ['wss://relay.centcom.dev/v1/ws', false, true],
  ['wss://relay-eu.centcom.dev/v1/ws', false, true],
  ['wss://203.0.113.5:7070/v1/ws', false, true],
  ['ws://203.0.113.5:7070', true, false],
  ['ws://203.0.113.5:7070', false, false],
  ['ws://8.8.8.8:7070', true, false],
  ['ws://192.168.1.20:7070', true, true],
  ['ws://192.168.1.20:7070', false, false],
  ['ws://localhost:7070', true, true],
  ['ws://localhost:7070', false, false],
  ['ws://127.0.0.1:7070', true, true],
  ['ws://10.0.0.7:7070', true, true],
  ['ws://172.16.0.1:7070', true, true],
  ['ws://172.31.255.255:7070', true, true],
  ['ws://172.32.0.1:7070', true, false],
  ['ws://169.254.10.10:7070', true, true],
  ['ws://[::1]:7070', true, true],
  ['ws://[fe80::1]:7070', true, true],
  ['ws://[fd12:3456::1]:7070', true, true],
  ['ws://[2001:db8::1]:7070', true, false],
  ['ws://[::ffff:192.168.0.2]:7070', true, true],
  ['ws://relay.centcom.dev/v1/ws', true, false],
  ['ws://relay.centcom.dev/v1/ws', false, false],
  ['ws://lan-host.local:7070', true, false],
  ['ws://300.1.1.1:7070', true, false],
  ['http://192.168.1.20:7070', true, false],
  ['wss://relay.centcom.dev/v1/ws?ticket=abc', false, false],
  ['wss://user:pass@relay.centcom.dev/v1/ws', false, false],
  ['not a url', true, false],
];

describe('which URLs may be dialled (AC11)', () => {
  for (const [url, allow, ok] of MATRIX) {
    it(`${url} with allowPlainWs=${allow}: ${ok ? 'accepted' : 'refused'}`, () => { expect(checkRelayUrl(url, { allowPlainWs: allow }).ok).toBe(ok); });
  }
  it('isPrivateHost only trusts literal private addresses and localhost', () => {
    expect(['127.0.0.1', '10.1.2.3', '192.168.0.1', 'LOCALHOST', '[::1]'].every(isPrivateHost)).toBe(true);
    expect(['example.com', '1.1.1.1', '100.64.0.1', '::', 'fe00::1'].some(isPrivateHost)).toBe(false);
  });
  it('the client refuses a public ws:// URL before opening any socket, and does not retry', async () => {
    const r = rig({ url: 'ws://203.0.113.5:7070', allowPlainWs: true }); const e = await r.client.connect().catch((x: unknown) => x);
    expect((e as RelayError).localCode).toBe('url_refused'); expect(r.srv.sockets).toHaveLength(0); expect(r.client.state).toBe('closed');
    await r.clock.advance(60_000); expect(r.srv.sockets).toHaveLength(0);
  });
  it('a LAN address is dialled when allowed, and a ws:// relay_url from the ticket is refused even then', async () => {
    const r = rig({ url: 'ws://192.168.1.20:7070', allowPlainWs: true }); void r.client.connect(); expect((await r.nextSocket()).url).toBe('ws://192.168.1.20:7070/');
    const r2 = rig({ allowPlainWs: true, getTicket: async () => ({ ticket: 'tkt.x.SECRET', url: 'ws://relay.centcom.dev/v1/ws' }) });
    expect(((await r2.client.connect().catch((x: unknown) => x)) as RelayError).localCode).toBe('url_refused');
  });
});
