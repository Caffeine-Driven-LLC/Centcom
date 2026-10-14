import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DeviceKeyStore, initCrypto, memoryKeychain } from '@centcom/net';
import { LanTransport } from '@centcom/session';
import { parseHostArgs, runLanHost, HOST_USAGE, type LanHostDeps } from '../../src/commands/lan/host.js';

/** `centcom lan host` (lane C072's CLI flags): the flags, the refusals, and a real guest that pairs with the printed code on a real socket. */
const stops: (() => void)[] = []; afterEach(() => { for (const s of stops.splice(0)) s(); });
function start(argv: string[], o: Partial<LanHostDeps> = {}) {
  const out: string[] = []; const err: string[] = []; const ac = new AbortController(); stops.push(() => ac.abort());
  let ready!: (i: { port: number; code: string; sessionId: string; fingerprint: string }) => void; const readyP = new Promise<Parameters<typeof ready>[0]>((r) => { ready = r; });
  const done = runLanHost(argv, { out: (l) => out.push(l), err: (l) => err.push(l), signal: ac.signal, keychain: memoryKeychain(), stateDir: mkdtempSync(join(tmpdir(), 'lan-host-')), hostName: 'ana-desktop', onReady: ready, advertiser: () => ({ start: async () => ({ instance: 'x', port: 0 }), stop: async () => undefined, setMemberCount: () => undefined }), ...o });
  return { out, err, ac, done, ready: readyP };
}

describe('flags', () => {
  it('reads --name, --bind, --port, --allow-wan and --no-announce; refuses anything else, a port outside 1 to 65535 and a name with control characters', () => {
    expect(parseHostArgs([])).toEqual({ name: 'Centcom session', allowWan: false, announce: true });
    expect(parseHostArgs(['--name', 'Fix the relay', '--bind', '127.0.0.1', '--port', '7071', '--allow-wan', '--no-announce'])).toEqual({ name: 'Fix the relay', bind: '127.0.0.1', port: 7071, allowWan: true, announce: false });
    for (const bad of [['--port', '0'], ['--port', '70000'], ['--port', 'x'], ['--port'], ['--bind'], ['--name', 'a\u001bb'], ['--nope']]) expect(parseHostArgs(bad), bad.join(' ')).toBeNull();
  });
  it('a bad flag prints the usage and exits 2 without starting anything', async () => { const t = start(['--port', '0']); expect(await t.done).toBe(2); expect(t.err).toEqual([HOST_USAGE]); expect(t.out).toEqual([]); });
});

describe('hosting', () => {
  it('a public address is refused unless --allow-wan, with a clear line and exit 2', async () => {
    const t = start(['--bind', '8.8.8.8', '--port', '7099']); expect(await t.done).toBe(2); expect(t.err.join(' ')).toMatch(/public address.*--allow-wan/);
  });
  it('listens on --bind, prints the code, the fingerprint and how to end it; a guest pairs with that code and the fingerprint over a real socket; Ctrl-C ends it with exit 0', { timeout: 30_000 }, async () => {
    const t = start(['--bind', '127.0.0.1', '--port', '47123', '--name', 'Fix the relay']); const r = await t.ready;
    expect(r.port).toBe(47123); expect(t.out.join('\n')).toMatch(/Hosting "Fix the relay" on port 47123 \(127\.0\.0\.1\)/); expect(t.out.join('\n')).toContain(`Pairing code: ${r.code}`); expect(t.out.join('\n')).toContain(`Fingerprint: ${r.fingerprint}`); expect(t.out.join('\n')).toMatch(/Ctrl-C/);
    await initCrypto(); const kc = memoryKeychain(); const device = new DeviceKeyStore(kc, 'dev_01JA3Z8K2M5N7P9Q0R1S2T3V4G'); await device.getOrCreatePublicKeys();
    const guest = new LanTransport({ host: '127.0.0.1', port: r.port, sessionId: r.sessionId, code: r.code, expectedFingerprint: r.fingerprint, keychain: kc, device, deviceInfo: { id: 'dev_01JA3Z8K2M5N7P9Q0R1S2T3V4G', name: 'bob-laptop' }, clientInfo: { name: 'centcom-cli', version: '1.0.0', contract: '1.2.0' } });
    const w = await guest.connect(); expect(guest.paired).toBe(true); expect(w).toBeTruthy(); await guest.close();
    t.ac.abort(); expect(await t.done).toBe(0); expect(t.out.at(-1)).toBe('Session ended.');
  });
  it('--no-announce says how to join by address; announcing says so, and an mDNS that cannot start is a note, not a failure', async () => {
    const quiet = start(['--bind', '127.0.0.1', '--port', '47124', '--no-announce']); await quiet.ready; expect(quiet.out.join('\n')).toMatch(/Not announced.*centcom join .*:47124/); quiet.ac.abort(); expect(await quiet.done).toBe(0);
    const loud = start(['--bind', '127.0.0.1', '--port', '47125']); await loud.ready; expect(loud.out.join('\n')).toMatch(/Announced on this network/); loud.ac.abort(); await loud.done;
    const { MdnsUnavailableError } = await import('@centcom/lan'); const broken = start(['--bind', '127.0.0.1', '--port', '47126'], { advertiser: () => ({ start: async () => { throw new MdnsUnavailableError('no multicast here'); }, stop: async () => undefined, setMemberCount: () => undefined }) }); await broken.ready; expect(broken.out.join('\n')).toMatch(/Not announced/); expect(broken.err.join(' ')).toMatch(/centcom join/); broken.ac.abort(); expect(await broken.done).toBe(0);
  });
});
