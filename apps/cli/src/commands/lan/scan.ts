/** `centcom lan scan [--timeout <seconds, default 3>] [--json]`: list LAN sessions announced over mDNS. No account, no backend. Exit 0 even when nothing is found or mDNS is unavailable (then it says how to join by ip:port); 2 on bad usage. */
import { LAN_MESSAGES, LanBrowser, MdnsUnavailableError, type LanBrowserOptions, type LanHost } from '@centcom/lan';

export interface LanIO { out(l: string): void; err(l: string): void; browser?: (o: LanBrowserOptions) => LanBrowser }

const USAGE = 'Usage: centcom lan scan [--timeout <seconds>] [--json]';

/** Parse `--timeout <s>` (0..60, default 3) and `--json`. */
export function parseScanArgs(argv: readonly string[]): { timeoutMs: number; json: boolean; bind?: string[] } | null {
  let timeout = 3; let json = false; const bind: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--json') json = true;
    else if (a === '--timeout' || a.startsWith('--timeout=')) { const v = a.includes('=') ? a.slice(10) : argv[++i]; const n = Number(v); if (v === undefined || v === '' || !Number.isFinite(n) || n < 0 || n > 60) return null; timeout = n; }
    else if (a === '--bind') { const v = argv[++i]; if (!v) return null; bind.push(v); }
    else return null;
  }
  return { timeoutMs: Math.round(timeout * 1000), json, ...(bind.length ? { bind } : {}) };
}

/** Terminal-safe: printable text only (names come from the network). */
const safe = (s: string) => s.replace(/[\p{Cc}\p{Cf}]/gu, '');
const short = (fp: string) => `${fp.slice(0, 4)}-…`;

/** One line per host: name, host, where to connect, members, the start of the fingerprint to compare. */
export function formatHosts(hosts: readonly LanHost[]): string[] {
  return hosts.map((h) => `${safe(h.name) || '(unnamed)'}  by ${safe(h.hostName) || '?'}  ${h.addresses.map((a) => (a.includes(':') ? `[${a}]` : a) + `:${h.port}`).join(', ') || `port ${h.port}`}  ${h.memberCount}/8  fp ${short(h.fingerprint)}`);
}

export async function runLanCli(argv: readonly string[], io: LanIO): Promise<number> {
  const [sub, ...rest] = argv;
  if (sub !== 'scan') { io.err(USAGE); return 2; }
  const args = parseScanArgs(rest); if (!args) { io.err(USAGE); return 2; }
  const browser = (io.browser ?? ((o) => new LanBrowser(o)))({ ...(args.bind ? { bind: args.bind } : {}) });
  let hosts: LanHost[] = [];
  try { hosts = await browser.scan(args.timeoutMs); } catch (e) {
    if (!(e instanceof MdnsUnavailableError)) throw e;
    if (args.json) io.out('[]'); else io.out(LAN_MESSAGES.mdns_unavailable);
    io.err(e.hint); return 0;
  }
  hosts.sort((a, b) => a.name.localeCompare(b.name) || a.instance.localeCompare(b.instance));
  if (args.json) { io.out(JSON.stringify(hosts)); if (hosts.length === 0) io.err(LAN_MESSAGES.scan_empty_hint); return 0; }
  if (hosts.length === 0) { io.out(LAN_MESSAGES.scan_empty); io.out(LAN_MESSAGES.scan_empty_hint); return 0; }
  for (const l of formatHosts(hosts)) io.out(l);
  io.out(LAN_MESSAGES.scan_join_hint);
  return 0;
}
