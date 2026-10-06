import { request } from 'node:http';
import { connect } from 'node:net';
import { networkInterfaces } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { MOCK_HOST, isLoopback, type MockBackend } from '../src/index.js';
import { start } from './helpers.js';

let m: MockBackend; afterEach(async () => { await m?.stop(); });

/** GET a control-plane path from a chosen local source address. */
const getFrom = (localAddress: string, port: number, path: string) => new Promise<number>((res, rej) => {
  const r = request({ host: '127.0.0.1', port, path, localAddress }, (x) => { x.resume(); res(x.statusCode ?? 0); }); r.on('error', rej); r.end();
});

describe('loopback only (AC12)', () => {
  it('the control plane trusts exactly the loopback addresses the mock listens on', () => {
    for (const a of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) expect(isLoopback(a), a).toBe(true);
    for (const a of ['10.0.0.5', '192.168.1.2', '::ffff:10.0.0.5', '0.0.0.0', '127.0.0.2', 'fe80::1', '', undefined]) expect(isLoopback(a), String(a)).toBe(false);
  });
  it('listens on 127.0.0.1 only: the URL says so and no other interface accepts a connection', async () => {
    m = await start(); const url = new URL(m.httpUrl); expect(url.hostname).toBe(MOCK_HOST); expect(new URL(m.wsUrl).hostname).toBe(MOCK_HOST);
    const external = Object.values(networkInterfaces()).flat().filter((i) => i && !i.internal && i.family === 'IPv4').map((i) => i!.address);
    for (const addr of external) {
      const refused = await new Promise<boolean>((res) => { const s = connect({ host: addr, port: Number(url.port) }); s.once('connect', () => { s.destroy(); res(false); }); s.once('error', () => res(true)); });
      expect(refused, addr).toBe(true);
    }
  });
  it('/__mock/* answers 404 to a peer whose source address is not loopback, and 200 to 127.0.0.1', async () => {
    m = await start(); const port = Number(new URL(m.httpUrl).port);
    expect(await getFrom('127.0.0.1', port, '/__mock/state')).toBe(200);
    if (process.platform === 'linux') expect(await getFrom('127.0.0.2', port, '/__mock/state')).toBe(404); /* Linux routes all of 127/8 locally, so a second source address is available */
    expect(await getFrom('127.0.0.1', port, '/healthz')).toBe(200);
  });
});
