/** `centcom update [--check] [--channel stable|beta|nightly] [--yes] [--rollback] [--json]`. Exit 0: up to date or updated, 1: failed, 10: an update is available (with --check). */
import { ManagedInstallError, UpdateError, updateCommand, type Channel, type CheckResult, type UpdateClient } from '@centcom/net';

export interface UpdateIo { out(l: string): void; err(l: string): void; confirm(q: string): Promise<boolean>; progress?(p: { received: number; total: number }): void }
export interface UpdateDeps { client(channel: Channel): UpdateClient; defaultChannel: Channel; version: string }
const CHANNELS = ['stable', 'beta', 'nightly'];

export async function runUpdate(argv: string[], d: UpdateDeps, io: UpdateIo): Promise<number> {
  const has = (f: string) => argv.includes(f); const json = has('--json'); const ci = argv.indexOf('--channel'); const channel = (ci >= 0 ? argv[ci + 1] : d.defaultChannel) as Channel;
  for (const a of argv) if (!['--check', '--yes', '--rollback', '--json', '--channel'].includes(a) && !(ci >= 0 && a === argv[ci + 1])) { io.err('Usage: centcom update [--check] [--channel stable|beta|nightly] [--yes] [--rollback] [--json]'); return 2; }
  if (!CHANNELS.includes(channel)) { io.err('--channel must be stable, beta or nightly'); return 2; }
  const say = (o: Record<string, unknown>, text: string) => (json ? io.out(JSON.stringify(o)) : io.out(text));
  const client = d.client(channel);
  try {
    if (has('--rollback')) { await client.rollback(); say({ rolled_back: true }, 'Went back to the version you had before. Start Centcom again to use it.'); return 0; }
    const c: CheckResult = await client.check();
    if (!c.available) { say({ available: false, current: d.version, channel, required: c.required }, c.required ? 'This version is too old for the service, but no newer one is published on this channel.' : `You are up to date (${d.version}, ${channel}).`); return c.required ? 1 : 0; }
    if (has('--check')) { say({ available: true, version: c.version, channel, required: c.required, notes: c.notesUrl }, `Version ${c.version} is available on ${channel}${c.required ? ' (needed: this version is too old)' : ''}.${c.notesUrl ? ` Notes: ${c.notesUrl}` : ''}`); return 10; }
    const how = updateCommand(client.method); if (how) { say({ available: true, version: c.version, command: how }, `Version ${c.version} is available. Centcom was installed with a package manager; update it with:\n  ${how}`); return 0; }
    if (!has('--yes') && !(await io.confirm(`Update from ${d.version} to ${c.version} (${channel})? [y/N] `))) { io.out('Cancelled. Nothing was changed.'); return 1; }
    const staged = await client.download({ onProgress: io.progress }); await client.verify(staged); const r = await client.apply(staged);
    say({ updated: true, from: r.previous, to: staged.version, restart: r.restartRequired }, `Updated to ${staged.version}. ${r.restartRequired ? 'Start Centcom again to use it. ' : ''}To go back: centcom update --rollback`); return 0;
  } catch (e) {
    if (e instanceof ManagedInstallError) { say({ error: e.code, command: e.command }, e.message); return 0; }
    const msg = e instanceof UpdateError ? e.message : 'The update could not be completed. Nothing was changed.'; if (json) io.out(JSON.stringify({ error: e instanceof UpdateError ? e.code : 'failed', message: msg })); else io.err(msg); return 1;
  }
}
