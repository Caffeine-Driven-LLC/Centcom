import { NOT_IN_PLAN } from './messages.js';
import { auditAllowed, fail, parseFlags, usage, workspaceOf, type AuditDeps, type Writer } from './common.js';
import { filtersOf } from './list.js';

export const POLL_STEPS_MS = [2000, 4000, 8000, 10_000]; export const GIVE_UP_MS = 5 * 60_000;
interface Job { id: string; status: 'pending' | 'ready' | 'failed' | 'expired'; format: string; download_url?: string | null; error?: string; code?: string }
export async function runExport(argv: string[], d: AuditDeps): Promise<number> {
  const f = parseFlags(argv); if ('error' in f) return usage(d, f.error);
  const format = f.values.get('--format'); if (format !== 'csv' && format !== 'json') return usage(d, 'Give --format csv or --format json.');
  const filters = filtersOf(f, new Date(d.clock.now())); if ('error' in filters) return usage(d, filters.error);
  const out = f.values.get('--out'); const wait = f.bools.has('--wait') || out !== undefined; if (out !== undefined && (!out || out.includes('\0'))) return usage(d, '--out needs a file name.');
  if (out && !f.bools.has('--force') && (await d.fs.exists(out))) return usage(d, `${out} already exists. Choose another name or add --force to replace it.`);
  let created = ''; let writer: Writer | undefined;
  const cleanup = async () => { if (writer) { await writer.abort().catch(() => undefined); writer = undefined; } };
  try {
    const ws = await workspaceOf(d, f); if (!(await auditAllowed(d, ws))) return usage(d, NOT_IN_PLAN);
    let job = (await d.http.call('createAuditExport', { path: { id: ws }, body: { format, ...filters } } as never, { signal: d.signal })).data as unknown as Job; created = job.id;
    d.io.err(`Export ${job.id} started.`); if (!wait) { d.io.out(f.bools.has('--json') ? JSON.stringify({ export: job.id, status: job.status }) : `Export ${job.id} is ${job.status}. Run again with --wait --out <file> to download it.`); return 0; }
    const t0 = d.clock.now(); let step = 0;
    while (job.status === 'pending') {
      if (d.clock.now() - t0 >= GIVE_UP_MS) { d.io.err(`Still not ready after 5 minutes. The export id is ${created}; run the export again later to get a fresh one.`); return 1; }
      await d.clock.sleep(POLL_STEPS_MS[Math.min(step++, POLL_STEPS_MS.length - 1)]!, d.signal); job = (await d.http.call('getAuditExport', { path: { id: ws, exp: created } } as never, { signal: d.signal })).data as unknown as Job;
    }
    if (job.status === 'failed') { d.io.err(`The export ${created} failed${job.code ? ` (${job.code})` : ''}.`); return 1; } if (job.status === 'expired') { d.io.err(`The export ${created} has expired. Run the command again.`); return 1; }
    if (!job.download_url) { d.io.err(`The export ${created} is ready but has no download address. Run the command again.`); return 1; }
    if (!out) { d.io.out(f.bools.has('--json') ? JSON.stringify({ export: created, status: 'ready' }) : `Export ${created} is ready. Add --out <file> to download it.`); return 0; }
    const res = await (d.fetch ?? fetch)(job.download_url, { signal: d.signal, redirect: 'error' }); if (!res.ok || !res.body) { d.io.err(`The download failed (HTTP ${res.status}).`); return 1; }
    writer = await d.fs.createWriter(out, 0o600); let bytes = 0; for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) { await writer.write(chunk); bytes += chunk.length; } await writer.close(); writer = undefined;
    d.io.out(f.bools.has('--json') ? JSON.stringify({ export: created, file: out, bytes }) : `Saved ${bytes} bytes to ${out}`); return 0;
  } catch (e) { await cleanup(); if (d.signal?.aborted) { d.io.err('Stopped. The partial file was removed.'); return 130; } if (e instanceof Error && !('code' in e) && /fetch failed|terminated|aborted/i.test(e.message)) { d.io.err('The download was interrupted. The partial file was removed.'); return 1; } return fail(d, e); }
}
