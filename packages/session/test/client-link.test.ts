import { afterEach, describe, expect, it } from 'vitest';
import { memoryKeychain, DeviceKeyStore } from '@centcom/net';
import { WS, rig, until } from '../../net/test/session/rig.js';
import { transportLinkFactory, type SessionTransport } from '../src/index.js';

let stop: (() => Promise<void>)[] = []; afterEach(async () => { for (const f of stop.splice(0).reverse()) await f(); });

describe('the session client connects through a transport (C074 wired to C057)', () => {
  it('host and guest talk through RelayTransport links opened by the client; a reconnect goes through the same transport', async () => {
    const r = await rig(); stop.push(() => r.stop()); const opened: SessionTransport[] = [];
    const deps = (name: string) => ({ keychain: memoryKeychain(), device: new DeviceKeyStore(memoryKeychain(), name), deviceInfo: { id: name, name }, allowPlainWs: true });
    await r.host.init({ linkFactory: transportLinkFactory({ kind: 'relay', sessionId: 'ses_pending' }, deps('host'), (t) => opened.push(t)) });
    await r.guest.init({ linkFactory: transportLinkFactory({ kind: 'relay', sessionId: 'ses_pending' }, deps('guest'), (t) => opened.push(t)) });
    const h = await r.host.client.createSession({ name: 'via transport', workspace: WS }); r.host.handle = h; stop.push(() => h.leave().catch(() => undefined));
    const g = await r.guest.client.joinSession({ sessionId: h.id }); r.guest.handle = g; stop.push(() => g.leave().catch(() => undefined)); await until(() => g.state === 'live', 30000);
    expect(opened.map((t) => t.kind)).toEqual(['relay', 'relay']);
    const seen: string[] = []; g.onAny((e) => seen.push(e.kind)); await h.sendEvent('message.system', { secret: { level: 'info', text: 'hello over the transport' } }); await until(() => seen.includes('message.system'), 30000);
    g.reconnect(); await until(() => g.link() === 'online' && g.state === 'live', 30000);
    await h.sendEvent('message.system', { secret: { level: 'info', text: 'after reconnect' } }); await until(() => seen.filter((k) => k === 'message.system').length === 2, 30000);
  });
});
