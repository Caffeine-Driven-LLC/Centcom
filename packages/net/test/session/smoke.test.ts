import { afterEach, describe, expect, it } from 'vitest';
import { rig, until, WS } from './rig.js';

let r: Awaited<ReturnType<typeof rig>> | undefined; afterEach(async () => { await r?.host.handle?.leave().catch(() => undefined); await r?.guest.handle?.leave().catch(() => undefined); await r?.stop(); r = undefined; });
describe('smoke', () => {
  it('host creates, guest joins, guest gets the key and reads an encrypted message', async () => {
    r = await rig(); const h = await r.host.client.createSession({ name: 'demo', workspace: WS }); r.host.handle = h; expect(h.state).toBe('live');
    const g = await r.guest.client.joinSession({ sessionId: h.id }); r.guest.handle = g; await until(() => g.state === 'live');
    const got: unknown[] = []; g.on('message.user', (e) => got.push(e.secret)); await h.sendEvent('message.user', { secret: { text: 'hello guest' } }); await until(() => got.length === 1); expect(got[0]).toMatchObject({ text: 'hello guest' });
  });
});
