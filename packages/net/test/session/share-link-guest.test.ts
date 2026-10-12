import { describe, expect, it } from 'vitest';
import { initCrypto, memoryKeychain, DeviceKeyStore, TrustStore } from '@centcom/net-crypto';
import { createSessionClient, sessionOfTicket } from '../../src/session/client.js';

const jwt = (claims: Record<string, unknown>) => `e30.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`;
const SID = 'ses_01KDVDNA00DEVSEED000000001'; const FRAG = `#k=${'A'.repeat(43)}&kid=k1`;

describe('a guest opening a share link', () => {
  it('reads the session from the ticket, because the join answer has no field for it', () => {
    expect(sessionOfTicket({ ticket: jwt({ sid: SID }) } as never)).toBe(SID); expect(sessionOfTicket({ ticket: 'garbage' } as never)).toBeUndefined(); expect(sessionOfTicket({ ticket: jwt({}) } as never)).toBeUndefined();
    expect(sessionOfTicket({ ticket: jwt({ sid: 'x' }), session: 'ses_direct' } as never)).toBe('ses_direct');
  });
  it('connects with the ticket the link gave, never asking for a member join token (that clashes with a signed-in user)', async () => {
    await initCrypto(); const ops: string[] = []; const sent: string[] = [];
    const http = { call: async (op: string) => { ops.push(op); if (op === 'joinViaShareLink') return { data: { ticket: jwt({ sid: SID, mid: 'mem_guest' }), relay_url: 'ws://127.0.0.1:1/v1/ws', member: 'mem_guest', role: 'viewer', expires_in: 60 } }; throw new Error(`unexpected ${op}`); }, paginate: () => (async function* () {})() } as never;
    const keychain = memoryKeychain(); const device = new DeviceKeyStore(keychain, 'dev_guest');
    const wsFactory = ((url: string) => { sent.push(url); throw new Error('no network in this test'); }) as never;
    const client = createSessionClient({ http, crypto: { device, trust: new TrustStore({ read: async () => undefined, write: async () => undefined } as never) }, deviceId: 'dev_guest', clientInfo: { name: 'test', version: '0', platform: 'linux' } as never, relayUrl: 'ws://127.0.0.1:1/v1/ws', allowPlainWs: true, wsFactory } as never);
    const attempt = client.joinViaShareLink({ token: 'tok', displayName: 'Visitor', fragment: FRAG }); await Promise.race([attempt.catch(() => undefined), new Promise((r) => setTimeout(r, 1500))]);
    expect(ops).toContain('joinViaShareLink'); expect(ops).not.toContain('createJoinToken'); expect(sent[0]).toContain('ws://127.0.0.1:1');
  });
  it('a ticket without the session in it is refused as a bad link', async () => {
    await initCrypto(); const http = { call: async () => ({ data: { ticket: 'no.jwt.here', relay_url: 'ws://x', member: 'mem_g', role: 'viewer' } }), paginate: () => (async function* () {})() } as never;
    const device = new DeviceKeyStore(memoryKeychain(), 'dev_g'); const client = createSessionClient({ http, crypto: { device, trust: new TrustStore({ read: async () => undefined, write: async () => undefined } as never) }, deviceId: 'dev_g', clientInfo: {} as never } as never);
    await expect(client.joinViaShareLink({ token: 't', displayName: 'V', fragment: FRAG })).rejects.toMatchObject({ code: 'bad_link' });
  });
});
