/** `centcom devices list [--json]` (GET /v1/devices, every page) and `centcom devices revoke <dev_id> [--yes]` (DELETE /v1/devices/{id}).
 *  Must not: revoke without confirmation (a prompt on a terminal, else --yes); prompt when not on a terminal; print a token. */
import { isId } from '@centcom/protocol';
import { clean, parseFlags, reportError, type AccountDeps } from './common.js';
import { EXIT, MSG } from './messages.js';

/** Most devices one listing shows (a person has a handful; this only bounds a broken server). */
export const MAX_DEVICES = 1000;
export interface DeviceJson { id: string; name: string; platform: string; last_seen: string | null; fingerprint: string; current: boolean }

export async function runDevices(argv: string[], d: AccountDeps): Promise<number> {
  const [sub, ...rest] = argv;
  if (sub === 'list') return list(rest, d);
  if (sub === 'revoke') return revoke(rest, d);
  d.io.err(MSG.usage.devices); return EXIT.failure;
}

/** The current device: the access token's `dev` claim, else the stored device id. */
async function currentDevice(d: AccountDeps): Promise<string | undefined> { return d.auth.claims()?.dev ?? (await d.auth.status()).deviceId; }

async function list(argv: string[], d: AccountDeps): Promise<number> {
  const f = parseFlags(argv, { bool: ['--json'] });
  if ('error' in f || f.positional.length) { d.io.err('error' in f ? f.error : MSG.usage.unknownFlag(f.positional[0]!)); d.io.err(MSG.usage.devices); return EXIT.failure; }
  try {
    await d.auth.getAccessToken(); const me = await currentDevice(d); const rows: DeviceJson[] = [];
    for await (const x of d.http.paginate('listDevices', {}, { limit: 100, signal: d.signal })) {
      rows.push({ id: x.id, name: x.name, platform: x.platform, last_seen: x.last_seen_at ?? null, fingerprint: x.key_fingerprint, current: me ? x.id === me : x.current === true });
      if (rows.length >= MAX_DEVICES) break;
    }
    if (f.bool.has('--json')) { d.io.out(JSON.stringify({ devices: rows })); return EXIT.ok; }
    if (!rows.length) { d.io.out(MSG.devices.empty); return EXIT.ok; }
    d.io.out(MSG.devices.header);
    for (const r of rows) d.io.out(MSG.devices.row(r.current, clean(r.name, 40), clean(r.platform, 16), r.last_seen ? clean(r.last_seen, 40).replace('T', ' ').slice(0, 16) : MSG.devices.never, clean(r.fingerprint, 20), r.id));
    if (rows.some((r) => r.current)) d.io.out(MSG.devices.legend);
    return EXIT.ok;
  } catch (e) { return reportError(e, d); }
}

async function revoke(argv: string[], d: AccountDeps): Promise<number> {
  const f = parseFlags(argv, { bool: ['--yes'] });
  if ('error' in f || f.positional.length !== 1) { d.io.err('error' in f ? f.error : MSG.usage.devices); return EXIT.failure; }
  const id = f.positional[0]!;
  if (!isId('dev', id)) { d.io.err(MSG.usage.badDeviceId); return EXIT.failure; }
  try {
    const st = await d.auth.status(); if (!st.signedIn) { d.io.err(MSG.errors.notSignedIn); return EXIT.authRequired; }
    await d.auth.getAccessToken(); const isCurrent = id === (await currentDevice(d));
    if (!f.bool.has('--yes')) {
      if (!d.io.isTTY || !d.confirm) { d.io.err(MSG.devices.needsYes); return EXIT.failure; }
      if (isCurrent) d.io.err(MSG.devices.confirmCurrent);
      const name = await d.http.call('getDevice', { path: { id } }).then((r) => clean(r.data.name, 40), () => id);
      if (!(await d.confirm(MSG.devices.confirm(name, id)))) { d.io.err(MSG.devices.notRevoked); return EXIT.failure; }
    } else if (isCurrent) d.io.err(MSG.devices.confirmCurrent);
    await d.http.call('revokeDevice', { path: { id } }, { signal: d.signal });
    if (isCurrent) { await d.auth.clearLocal().catch(() => undefined); d.io.out(MSG.devices.revokedCurrent); return EXIT.ok; }
    d.io.out(MSG.devices.revoked(id)); return EXIT.ok;
  } catch (e) { return reportError(e, d); }
}
