/** `centcom update [--check] [--channel stable|beta|nightly] [--yes] [--allow-downgrade] [--rollback] [--json]`.
 *  Exit 0: up to date or updated, 1: failed, cancelled or refused, 2: bad options, 10: an update is available (with --check), 11: verification failed,
 *  12: this install cannot update itself (npm, Homebrew, a source checkout; the command to run is shown and no file is touched). */
import { ManagedInstallError, UpdateError, updateCommand, type Channel, type CheckResult, type StagedUpdate, type UpdateClient } from '@centcom/net';
import type { ApplyResult } from '../../autoupdate/apply.js';
import { channelSwitch, downgradeDecision } from '../../autoupdate/policy.js';

export interface UpdateIo { out(l: string): void; err(l: string): void; confirm(q: string): Promise<boolean>; progress?(p: { received: number; total: number }): void }
export interface UpdateDeps {
  client(channel: Channel): UpdateClient; defaultChannel: Channel; version: string;
  /** Puts a verified download in place with the health check and rollback (`applyUpdate`). Default: the client's own apply, with no health check. */
  applyStaged?(client: UpdateClient, staged: StagedUpdate): Promise<ApplyResult>;
}
const CHANNELS = ['stable', 'beta', 'nightly']; const VERIFY_CODES = ['hash_mismatch', 'bad_signature', 'not_verified', 'too_large'];
const USAGE = 'Usage: centcom update [--check] [--channel stable|beta|nightly] [--yes] [--allow-downgrade] [--rollback] [--json]';

export async function runUpdate(argv: string[], d: UpdateDeps, io: UpdateIo): Promise<number> {
  const has = (f: string) => argv.includes(f); const json = has('--json'); const ci = argv.indexOf('--channel'); const channel = (ci >= 0 ? argv[ci + 1] : d.defaultChannel) as Channel;
  for (const a of argv) if (!['--check', '--yes', '--rollback', '--json', '--channel', '--allow-downgrade'].includes(a) && !(ci >= 0 && a === argv[ci + 1])) { io.err(USAGE); return 2; }
  if (!CHANNELS.includes(channel)) { io.err('--channel must be stable, beta or nightly'); return 2; }
  const say = (o: Record<string, unknown>, text: string) => (json ? io.out(JSON.stringify(o)) : io.out(text));
  const allowDowngrade = has('--allow-downgrade'); const client = d.client(channel);
  try {
    if (has('--rollback')) { await client.rollback(); say({ rolled_back: true }, 'Went back to the version you had before. Start Centcom again to use it.'); return 0; }
    const c: CheckResult = await client.check({ allowDowngrade });
    if (c.downgrade && !c.available && downgradeDecision(d.version, c.downgrade.version, allowDowngrade) === 'downgrade_refused') {
      say({ available: false, refused: 'downgrade', current: d.version, channel, offered: c.downgrade.version }, `The newest version on ${channel} (${c.downgrade.version}) is older than yours (${d.version}), so nothing was changed. To go back anyway: centcom update --channel ${channel} --allow-downgrade`); return 1;
    }
    if (!c.available) { say({ available: false, current: d.version, channel, required: c.required }, c.required ? 'This version is too old for the service, but no newer one is published on this channel.' : `You are up to date (${d.version}, ${channel}).`); return c.required ? 1 : 0; }
    if (has('--check')) { say({ available: true, version: c.version, channel, required: c.required, notes: c.notesUrl }, `Version ${c.version} is available on ${channel}${c.required ? ' (needed: this version is too old)' : ''}.${c.notesUrl ? ` Notes: ${c.notesUrl}` : ''}`); return 10; }
    if (client.method !== 'sea') {
      const how = updateCommand(client.method);
      say({ available: true, version: c.version, ...(how ? { command: how } : {}), error: 'managed_install' }, how ? `Version ${c.version} is available. Centcom was installed with a package manager, so it does not update itself. Update it with:\n  ${how}` : `Version ${c.version} is available. You are running from a source checkout, which does not update itself: pull the latest and rebuild.`); return 12;
    }
    const sw = channelSwitch({ from: d.defaultChannel, to: channel, yes: has('--yes') });
    if (sw.warning) io.err(sw.warning);
    if (sw.needsConfirm && !(await io.confirm(`Switch to the ${channel} channel? [y/N] `))) { io.out('Cancelled. Nothing was changed.'); return 1; }
    const down = !!c.downgrade && allowDowngrade;
    if (!has('--yes') && !sw.needsConfirm && !(await io.confirm(`${down ? 'Go back' : 'Update'} from ${d.version} to ${c.version} (${channel})? [y/N] `))) { io.out('Cancelled. Nothing was changed.'); return 1; }
    const staged = await client.download({ onProgress: io.progress }); await client.verify(staged);
    if (d.applyStaged) {
      const r = await d.applyStaged(client, staged);
      if (!r.ok) {
        const text = r.code === 'deferred' ? 'A session is open, so the update was not applied. Close it and run this again.' : r.rolledBack ? 'The new version did not start, so the old one was put back. Nothing else was changed.' : 'The update could not be put in place and the old version is still there.';
        say({ error: r.code, rolled_back: r.rolledBack }, text); return 1;
      }
      say({ updated: true, from: r.from, to: r.to, restart: true }, `Updated to ${r.to}. Start Centcom again to use it. To go back: centcom update --rollback`); return 0;
    }
    const r = await client.apply(staged);
    say({ updated: true, from: r.previous, to: staged.version, restart: r.restartRequired }, `Updated to ${staged.version}. ${r.restartRequired ? 'Start Centcom again to use it. ' : ''}To go back: centcom update --rollback`); return 0;
  } catch (e) {
    if (e instanceof ManagedInstallError) { say({ error: e.code, command: e.command }, e.message); return 12; }
    const verification = e instanceof UpdateError && VERIFY_CODES.includes(e.code);
    const msg = e instanceof UpdateError ? e.message : 'The update could not be completed. Nothing was changed.'; if (json) io.out(JSON.stringify({ error: e instanceof UpdateError ? e.code : 'failed', message: msg })); else io.err(msg); return verification ? 11 : 1;
  }
}
