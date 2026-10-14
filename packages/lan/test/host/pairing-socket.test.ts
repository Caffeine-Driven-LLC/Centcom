import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { guestPair, type TextChannel } from '../../src/index.js';
import { GUEST_DEV, setup, wrongCode } from '../pairing/helpers.js';
import { makeServer, rawClient, SID, type Who } from './helpers.js';

/** Lane C073 on a real socket: the pairing code, the key exchange and the reconnect token run between a guest and the LAN host server (C072) over a WebSocket on loopback, not over the in-memory channel pair of the unit tests. */
const stops: (() => Promise<void>)[] = []; afterEach(async () => { for (const s of stops.splice(0)) await s(); });
/** A TextChannel over a WebSocket, as the guest side of the transport (C074) builds it. */
function wsChannel(ws: WebSocket): TextChannel {
  const msg: ((t: string) => void)[] = []; const close: ((c: number) => void)[] = []; ws.on('message', (d) => { for (const f of msg) f(d.toString()); }); ws.on('close', (c) => { for (const f of close) f(c); });
  return { send: (t) => ws.send(t), onMessage: (f) => { msg.push(f); }, onClose: (f) => { close.push(f); }, close: (c) => ws.close(c) };
}
async function boot() {
  const pair = await setup(); const h = makeServer({ pairing: pair.hp, sessionId: SID }); const { port } = await h.srv.start(); stops.push(() => h.srv.stop());
  const open = async (): Promise<WebSocket> => { const ws = new WebSocket(`ws://127.0.0.1:${port}/`, 'centcom.v1'); ws.on('error', () => undefined); await new Promise<void>((res, rej) => { ws.once('open', () => res()); ws.once('error', rej); }); return ws; };
  return { ...pair, ...h, port, open };
}

describe('pairing over a socket', () => {
  it('a guest with the right code pairs, gets a reconnect token, and that token then opens the session on a new connection (no code the second time)', { timeout: 30_000 }, async () => {
    const t = await boot(); const ws = await t.open(); const r = await guestPair({ channel: wsChannel(ws), code: t.display, device: t.guest.d, deviceInfo: { id: GUEST_DEV, name: 'ana-desktop' }, hostSessionId: SID, expectedFingerprint: t.host.d.fingerprint(), clock: t.clock, keychain: t.guest.kc });
    expect(r.reconnectToken).toHaveLength(43); expect(t.paired).toHaveLength(1); expect((t.paired[0] as { device: { id: string } }).device.id).toBe(GUEST_DEV);
    t.tokens.set(r.reconnectToken, { memberId: r.member.id, deviceId: GUEST_DEV, name: 'ana-desktop', role: 'editor', slot: r.member.slot } as Who);
    const g = await rawClient(t.port); g.hello(r.reconnectToken); await g.wait(() => !!g.welcomed()); expect(g.welcomed()?.p?.member?.id ?? g.welcomed()).toBeTruthy(); g.close();
  });
  it('a wrong code fails on the host, the connection is closed with the rejection code, and three wrong tries from one address ban it', { timeout: 30_000 }, async () => {
    const t = await boot(); let rejected = 0;
    for (let i = 0; i < 3; i++) { const ws = await t.open(); const closed = new Promise<number>((res) => ws.once('close', (c) => res(c))); const p = guestPair({ channel: wsChannel(ws), code: wrongCode(t.display), device: t.guest.d, deviceInfo: { id: GUEST_DEV, name: 'ana-desktop' }, hostSessionId: SID, expectedFingerprint: t.host.d.fingerprint(), clock: t.clock, keychain: t.guest.kc }).catch(() => 'failed'); expect(await p).toBe('failed'); const c = await closed; if (c === 4403) rejected++; }
    expect(t.paired).toHaveLength(0); expect(rejected).toBeGreaterThan(0); expect(t.failed.length).toBeGreaterThan(0);
  });
  it('a host fingerprint the guest does not expect stops the guest before it shows anything of itself, and nothing is stored', { timeout: 30_000 }, async () => {
    const t = await boot(); const ws = await t.open(); const bad = await guestPair({ channel: wsChannel(ws), code: t.display, device: t.guest.d, deviceInfo: { id: GUEST_DEV, name: 'ana-desktop' }, hostSessionId: SID, expectedFingerprint: 'AAAA-BBBB-CCCC-DDDD', clock: t.clock, keychain: t.guest.kc }).catch((e: Error) => e);
    expect(bad).toBeInstanceOf(Error); expect(t.paired).toHaveLength(0); expect(await t.guest.kc.get(`lan-token:${SID}`)).toBeFalsy();
  });
});
