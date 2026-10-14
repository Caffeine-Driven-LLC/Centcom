/**
 * `centcom lan host [--name <text>] [--bind <ip>] [--port <n>] [--allow-wan] [--no-announce]`: hosts a session on this network, no account and no server.
 * It starts the LAN host server and the host engine, announces the session over mDNS (unless `--no-announce`), prints a one-time pairing code and the
 * host's fingerprint, and runs until Ctrl-C. A guest runs `centcom join <ip:port>` (or finds it with `centcom lan scan`), types the code once, and
 * reconnects with a token after that. The server refuses a public address unless `--allow-wan` says so.
 * Must not: keep the pairing code anywhere but the screen, or write the host's keys anywhere but the keychain it is given.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { LanAdvertiser, LanHostServer, HostPairing, MdnsUnavailableError, MemoryBanList, PublicBindRefusedError, SessionTrustStore, systemClock, tokenValidator, type LanClock } from '@centcom/lan';
import { newIdGenerator } from '@centcom/protocol';
import { DeviceKeyStore, initCrypto, type Keychain } from '@centcom/net';
import { HostSessionEngine, createFilePersistence } from '@centcom/session';

export const HOST_USAGE = 'Usage: centcom lan host [--name <text>] [--bind <ip>] [--port <1-65535>] [--allow-wan] [--no-announce]';
export interface HostArgs { name: string; bind?: string; port?: number; allowWan: boolean; announce: boolean }
/** Reads the flags; null when something is wrong. A port of 0 is not accepted here (the default is 7070, and a busy port falls back to a free one). */
export function parseHostArgs(argv: readonly string[]): HostArgs | null {
  const a: HostArgs = { name: 'Centcom session', allowWan: false, announce: true };
  for (let i = 0; i < argv.length; i++) {
    const f = argv[i]!;
    if (f === '--allow-wan') a.allowWan = true; else if (f === '--no-announce') a.announce = false;
    else if (f === '--name') { const v = argv[++i]; if (!v || v.length > 60 || /[\p{Cc}\p{Cf}]/u.test(v)) return null; a.name = v; }
    else if (f === '--bind') { const v = argv[++i]; if (!v || v.startsWith('--')) return null; a.bind = v; }
    else if (f === '--port') { const v = argv[++i]; const n = Number(v); if (v === undefined || !/^\d+$/.test(v) || n < 1 || n > 65535) return null; a.port = n; }
    else return null;
  }
  return a;
}

export interface LanHostDeps {
  out(l: string): void; err(l: string): void; signal: AbortSignal; keychain: Keychain; stateDir: string; hostName: string; clock?: LanClock;
  /** Replaces the mDNS advertiser (tests). */ advertiser?: (o: ConstructorParameters<typeof LanAdvertiser>[0]) => Pick<LanAdvertiser, 'start' | 'stop' | 'setMemberCount'>;
  /** Called once the session is listening (tests read the port and the code from here). */ onReady?(i: { port: number; code: string; sessionId: string; fingerprint: string }): void;
}

export async function runLanHost(argv: readonly string[], d: LanHostDeps): Promise<number> {
  const args = parseHostArgs(argv); if (!args) { d.err(HOST_USAGE); return 2; }
  const clock = d.clock ?? systemClock; await initCrypto();
  const ids = newIdGenerator({ now: () => clock.now(), random: (n) => crypto.getRandomValues(new Uint8Array(n)) });
  const sessionId = ids.next('ses'); const hostId = ids.next('mem'); const deviceId = ids.next('dev');
  const device = new DeviceKeyStore(d.keychain, deviceId); await device.getOrCreatePublicKeys(); const fingerprint = device.fingerprint();
  const dir = join(d.stateDir, 'lan'); mkdirSync(dir, { recursive: true, mode: 0o700 });
  const policy = { queue_limit: 20, auto_approve: 'ask' as const, share_history: true };
  const pairing = new HostPairing({ sessionId, sessionName: args.name, policy, device, deviceInfo: { id: deviceId, name: d.hostName }, fingerprint, clock, bans: new MemoryBanList(clock), trust: new SessionTrustStore() });
  const server = new LanHostServer({
    sessionId, sessionName: args.name, hostMember: { id: hostId, name: d.hostName, slot: 0, role: 'host' }, ...(args.port !== undefined ? { port: args.port } : {}), ...(args.bind ? { bind: args.bind } : {}), allowWan: args.allowWan,
    tokens: tokenValidator(pairing.tokens, (id) => pairing.memberFor(id)), pairing, transcriptPath: join(dir, `${sessionId}.jsonl`), clock, ids: { next: (p) => ids.next(p) },
  });
  let listening: { port: number };
  try { listening = await server.start(); } catch (e) { if (e instanceof PublicBindRefusedError) { d.err(e.message); return 2; } d.err('Could not start the session on this network: ' + (e instanceof Error ? e.message : 'unknown error')); return 1; }
  const engine = new HostSessionEngine({ server, persistence: createFilePersistence(join(dir, 'history')), tokens: pairing.tokens, clock: clock as never, policy }); await engine.start();
  let members = 1; engine.on('member-joined', () => { members++; ann?.setMemberCount(members); }); engine.on('member-left', () => { members = Math.max(1, members - 1); ann?.setMemberCount(members); });
  let ann: Pick<LanAdvertiser, 'start' | 'stop' | 'setMemberCount'> | undefined;
  if (args.announce) {
    const o = { sessionId, sessionName: args.name, hostName: d.hostName, fingerprint, port: listening.port, memberCount: () => members, ...(args.bind ? { bind: [args.bind] } : {}) };
    ann = (d.advertiser ?? ((x) => new LanAdvertiser(x)))(o);
    try { await ann.start(); } catch (e) { if (e instanceof MdnsUnavailableError) { d.err(e.hint); ann = undefined; } else throw e; }
  }
  const code = pairing.openCode();
  d.out(`Hosting "${args.name}" on port ${listening.port}${args.bind ? ` (${args.bind})` : ''}.`);
  d.out(`Pairing code: ${code.display}   (once; it stops working after five minutes or when a guest has used it)`);
  d.out(`Fingerprint: ${fingerprint}   (a guest compares it with what they see)`);
  d.out(args.announce && ann ? 'Announced on this network: guests find it with `centcom lan scan`.' : 'Not announced: guests join with `centcom join <this computer\'s address>:' + listening.port + '`.');
  d.out('Press Ctrl-C to end the session.');
  d.onReady?.({ port: listening.port, code: code.display, sessionId, fingerprint });
  await new Promise<void>((res) => { if (d.signal.aborted) res(); else d.signal.addEventListener('abort', () => res(), { once: true }); });
  pairing.closeCode(); await ann?.stop().catch(() => undefined); await engine.stop('done').catch(() => undefined); d.out('Session ended.');
  return 0;
}
