import { describe, expect, it } from 'vitest';
import { MdnsUnavailableError, type LanBrowser, type LanHost } from '@centcom/lan';
import { formatHosts, parseScanArgs, runLanCli } from '../src/commands/lan/scan.js';

const host = (name: string, o: Partial<LanHost> = {}): LanHost => ({ instance: `${name}-ab12`, sessionId: 'ses_01JA3Z8K2M5N7P9Q0R1S2T3V4W', name, hostName: 'maya-laptop', fingerprint: 'ABCD-EFGH-2345', port: 7070, addresses: ['192.168.1.10'], memberCount: 2, pairRequired: true, lastSeen: 0, ...o });
const io = (hosts: LanHost[] | Error) => { const out: string[] = []; const err: string[] = []; return { out, err, io: { out: (l: string) => out.push(l), err: (l: string) => err.push(l), browser: () => ({ scan: async () => { if (hosts instanceof Error) throw hosts; return hosts; } }) as unknown as LanBrowser } }; };
describe('centcom lan scan', () => {
  it('--json prints an array sorted by name and exits 0, also when empty (with a hint on stderr)', async () => {
    const a = io([host('zeta'), host('alpha')]); expect(await runLanCli(['scan', '--json'], a.io)).toBe(0); expect(JSON.parse(a.out[0]!).map((h: LanHost) => h.name)).toEqual(['alpha', 'zeta']);
    const e = io([]); expect(await runLanCli(['scan', '--json'], e.io)).toBe(0); expect(e.out).toEqual(['[]']); expect(e.err.join(' ')).toMatch(/centcom join/);
  });
  it('the text form: one line per host with address, members and the start of the fingerprint; names cannot smuggle control characters', async () => {
    const a = io([host('Fix\u001b[2J the relay')]); expect(await runLanCli(['scan'], a.io)).toBe(0); const line = a.out[0]!; expect(line).toContain('192.168.1.10:7070'); expect(line).toContain('2/8'); expect(line).toMatch(/fp ABCD/); expect(line).not.toMatch(/\u001b/); expect(a.out.at(-1)).toMatch(/centcom join/);
    expect(formatHosts([host('x', { addresses: ['fe80::1'] })])[0]).toContain('[fe80::1]:7070');
    const none = io([]); expect(await runLanCli(['scan'], none.io)).toBe(0); expect(none.out[0]).toMatch(/No Centcom sessions/);
  });
  it('mDNS unavailable is not a failure: it says how to join directly and still exits 0', async () => { const a = io(new MdnsUnavailableError('EADDRINUSE')); expect(await runLanCli(['scan'], a.io)).toBe(0); expect(a.out.join(' ')).toMatch(/mDNS/); expect(a.err.join(' ')).toMatch(/centcom join/); const j = io(new MdnsUnavailableError('EADDRINUSE')); await runLanCli(['scan', '--json'], j.io); expect(j.out).toEqual(['[]']); });
  it('arguments: timeout 0 to 60, --json, --bind; anything else is exit 2 with usage', async () => {
    expect(parseScanArgs(['--timeout', '5', '--json'])).toEqual({ timeoutMs: 5000, json: true }); expect(parseScanArgs(['--timeout=0'])?.timeoutMs).toBe(0); expect(parseScanArgs(['--timeout', '61'])).toBeNull(); expect(parseScanArgs(['--timeout', 'x'])).toBeNull(); expect(parseScanArgs(['--bind', 'eth0'])).toMatchObject({ bind: ['eth0'] }); expect(parseScanArgs(['--wat'])).toBeNull();
    const a = io([]); expect(await runLanCli(['nope'], a.io)).toBe(2); expect(await runLanCli(['scan', '--wat'], a.io)).toBe(2); expect(a.err[0]).toMatch(/^Usage:/);
  });
});
