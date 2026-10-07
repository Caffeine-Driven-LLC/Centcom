import { TimeFilterError, parseTimeFilter } from './time-filter.js';
import { NOT_IN_PLAN } from './messages.js';
import { auditAllowed, fail, parseFlags, usage, workspaceOf, type AuditDeps, type Filters } from './common.js';
import { renderTable, type AuditEvent } from './render.js';

export function filtersOf(f: { values: Map<string, string> }, now: Date): Filters | { error: string } {
  const out: Filters = {}; try { if (f.values.has('--from')) out.from = parseTimeFilter(f.values.get('--from')!, now); if (f.values.has('--to')) out.to = parseTimeFilter(f.values.get('--to')!, now); } catch (e) { if (e instanceof TimeFilterError) return { error: e.message }; throw e; }
  if (out.from && out.to && out.from > out.to) return { error: '--from is later than --to.' }; const a = f.values.get('--actor'); const x = f.values.get('--action'); if (a !== undefined) { if (!a || a.length > 100) return { error: '--actor must be an id of up to 100 characters.' }; out.actor = a; } if (x !== undefined) { if (!x || x.length > 100) return { error: '--action must be a name of up to 100 characters.' }; out.action = x; } return out;
}
export async function runList(argv: string[], d: AuditDeps): Promise<number> {
  const f = parseFlags(argv); if ('error' in f) return usage(d, f.error);
  const lim = f.values.get('--limit'); const limit = lim === undefined ? 50 : Number(lim); if (!Number.isInteger(limit) || limit < 1 || limit > 1000) return usage(d, '--limit must be a whole number from 1 to 1000.');
  const filters = filtersOf(f, new Date(d.clock.now())); if ('error' in filters) return usage(d, filters.error);
  try {
    const ws = await workspaceOf(d, f); if (!(await auditAllowed(d, ws))) return usage(d, NOT_IN_PLAN);
    const rows: AuditEvent[] = []; const query = { ...(filters.actor ? { actor: filters.actor } : {}), ...(filters.action ? { action: filters.action } : {}), ...(filters.from ? { from: filters.from } : {}), ...(filters.to ? { to: filters.to } : {}) };
    for await (const e of d.http.paginate('listAuditEvents', { path: { id: ws }, query } as never, { limit: Math.min(200, limit), signal: d.signal })) { rows.push(e as unknown as AuditEvent); if (rows.length >= limit) break; }
    if (f.bools.has('--json')) { d.io.out(JSON.stringify(rows)); return rows.length === 0 ? 4 : 0; }
    if (rows.length === 0) { d.io.out('No audit events match.'); return 4; } for (const l of renderTable(rows)) d.io.out(l); return 0;
  } catch (e) { return fail(d, e); }
}
