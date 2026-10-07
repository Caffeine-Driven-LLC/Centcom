import { Link, createRoute, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { rootRoute } from '../app/root.js';
import type { RouteModule } from '../app/types.js';
import { useHttp } from '../lib/http-context.js';
import { Banner, Button, Card, EmptyState, Input, Skeleton, Table, useToast } from '../ui/index.js';
import { ulid, useWsRole } from './hooks.js';
import { AuditTable, DeliveriesTable, HealthChip, SecretModal, WebhookForm } from './components.js';
import { SecretVault, auditPager, createWebhook, deleteWebhook, deliveriesPager, entitlementState, filterFromQuery, filterToQuery, redeliver, rotateSecret, runExport, testWebhook, updateWebhook, type AuditFilter, type Webhook } from './data.js';
import { can, REASON } from '../workspace/rbac.js';

const Forbidden = (): React.JSX.Element => <Card title="Not available"><p>You do not have access to this page.</p></Card>;
function Webhooks(): React.JSX.Element {
  const { wsp } = useParams({ strict: false }) as { wsp: string }; const http = useHttp(); const { toast } = useToast(); const { role, ent, loaded } = useWsRole(wsp); const vault = useRef(new SecretVault()).current; const [rows, setRows] = useState<Webhook[]>(); const [, bump] = useState(0); const [key] = useState(() => ulid());
  const allowed = can(role, 'manage_webhooks'); const st = entitlementState(ent);
  const load = useCallback(() => { if (!allowed) return; void http.listPage('listWebhooks', { id: wsp }).then((p) => setRows(p.data as Webhook[])).catch(() => setRows([])); }, [http, wsp, allowed]); useEffect(load, [load]);
  if (loaded && !allowed) return <Forbidden />; if (!loaded) return <Skeleton lines={3} />;
  const atLimit = st.webhooksOff || (st.webhooksMax !== undefined && rows !== undefined && rows.length >= st.webhooksMax);
  return <Card title="Webhooks">{st.webhooksOff ? <EmptyState title="Webhooks are not in your plan" action={<Link to={`/w/${wsp}/billing` as never}>See billing</Link>}>Upgrade to send events to your own servers.</EmptyState> : null}
    {rows === undefined ? <Skeleton lines={2} /> : rows.length ? <Table caption="Endpoints" rows={rows} rowKey={(w) => w.id} columns={[{ key: 'u', header: 'Address', cell: (w) => <Link to={`/w/${wsp}/webhooks/${w.id}` as never}>{w.url}</Link> }, { key: 'e', header: 'Events', cell: (w) => w.events.length }, { key: 's', header: 'Health', cell: (w) => <HealthChip status={w.status} enabled={w.enabled} /> }]} /> : null}
    {!st.webhooksOff ? <WebhookForm disabledReason={atLimit ? 'Your plan has reached its number of endpoints.' : undefined} onSubmit={async (v) => { const r = await createWebhook(http, wsp, v, vault, key); if (r.ok) { bump((x) => x + 1); load(); } else toast('danger', r.reason === 'limit' ? 'Your plan has reached its number of endpoints.' : r.message ?? 'The endpoint could not be created.'); }} /> : null}
    {vault.open ? <SecretModal vault={vault} onClose={() => bump((x) => x + 1)} /> : null}</Card>;
}
function WebhookDetail(): React.JSX.Element {
  const { wsp, id } = useParams({ strict: false }) as { wsp: string; id: string }; const http = useHttp(); const nav = useNavigate(); const { toast } = useToast(); const { role, loaded } = useWsRole(wsp); const vault = useRef(new SecretVault()).current; const [w, setW] = useState<Webhook>(); const [, bump] = useState(0); const allowed = can(role, 'manage_webhooks');
  const pager = useMemo(() => deliveriesPager(http, id), [http, id]); const load = useCallback(() => { void pager.loadMore().finally(() => bump((x) => x + 1)); }, [pager]);
  useEffect(() => { if (!allowed) return; void http.call('getWebhook', { id }).then((r) => setW(r.data as Webhook)).catch(() => undefined); load(); }, [http, id, allowed, load]);
  if (loaded && !allowed) return <Forbidden />; if (!w) return <Skeleton lines={3} />;
  return <Card title={w.url}><HealthChip status={w.status} enabled={w.enabled} />
    <div><Button onClick={() => void updateWebhook(http, id, { enabled: !w.enabled }).then((r) => { if (r.ok) setW(r.webhook); else toast('danger', 'That could not be changed.'); })}>{w.enabled ? 'Disable' : 'Enable'}</Button> <Button onClick={() => void rotateSecret(http, id, vault).then((r) => { if (!r.ok) toast('danger', 'The secret could not be rotated.'); else bump((x) => x + 1); })}>Rotate secret</Button> <Button onClick={() => void testWebhook(http, id).then((r) => { if (r.ok) { toast(r.delivery.status === 'timeout' ? 'warning' : 'info', r.delivery.status === 'timeout' ? 'The test timed out. It will be tried again on the retry schedule.' : 'Test sent.'); pager.reset(); load(); } else toast('danger', 'The test could not be sent.'); })}>Send a test</Button> <Button variant="danger" onClick={() => void deleteWebhook(http, id).then((r) => (r.ok ? nav({ to: `/w/${wsp}/webhooks` as never }) : toast('danger', 'It could not be deleted.')))}>Delete endpoint</Button></div>
    <DeliveriesTable rows={pager.items} onRedeliver={(d) => void redeliver(http, id, d.id).then((r) => (r.ok ? toast('success', 'Queued again.') : toast('danger', r.reason === 'forbidden' ? 'You are not allowed to do that.' : 'It could not be delivered again.')))} />{pager.hasMore ? <Button onClick={load}>Load more</Button> : null}
    {vault.open ? <SecretModal vault={vault} rotated overlapNote={w.secret_overlap_until ? undefined : undefined} onClose={() => bump((x) => x + 1)} /> : null}</Card>;
}
function Audit(): React.JSX.Element {
  const { wsp } = useParams({ strict: false }) as { wsp: string }; const http = useHttp(); const nav = useNavigate(); const search = useSearch({ strict: false }) as Record<string, string>; const { role, ent, loaded } = useWsRole(wsp); const allowed = can(role, 'read_audit'); const st = entitlementState(ent);
  const filter = useMemo(() => filterFromQuery(new URLSearchParams(search as never)), [search]); const pager = useMemo(() => auditPager(http, wsp, filter), [http, wsp, filter]); const [, bump] = useState(0); const [exp, setExp] = useState<string>(); const [draft, setDraft] = useState<AuditFilter>(filter);
  const load = useCallback(() => { void pager.loadMore().finally(() => bump((x) => x + 1)); }, [pager]); useEffect(() => { if (allowed && !st.auditOff && loaded) load(); }, [allowed, st.auditOff, loaded, load]);
  if (loaded && !allowed) return <Forbidden />; if (!loaded) return <Skeleton lines={3} />;
  if (st.auditOff) return <Card title="Audit log"><EmptyState title="The audit log is not in your plan" action={<Link to={`/w/${wsp}/billing` as never}>See billing</Link>}>Upgrade to keep a record of who did what.</EmptyState></Card>;
  const apply = (): void => { void nav({ to: `/w/${wsp}/audit` as never, search: Object.fromEntries(new URLSearchParams(filterToQuery(draft))) as never }); };
  return <Card title="Audit log"><form onSubmit={(e) => { e.preventDefault(); apply(); }}>{(['actor', 'action', 'from', 'to'] as const).map((k) => <Input key={k} label={k === 'from' || k === 'to' ? `${k === 'from' ? 'From' : 'To'} (date)` : k === 'actor' ? 'Who' : 'Action'} type={k === 'from' || k === 'to' ? 'date' : 'text'} value={draft[k] ?? ''} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} />)}<Button type="submit">Apply filters</Button></form>
    <AuditTable rows={pager.items} />{pager.hasMore ? <Button onClick={load}>Load more</Button> : null}
    <Button onClick={() => { setExp('Preparing the export…'); void runExport(http, wsp, { format: 'csv', ...filter }, { sleep: (ms) => new Promise((r) => setTimeout(r, ms)), now: () => Date.now() }).then((o) => setExp(o.state === 'ready' ? o.url : o.state === 'failed' ? 'FAILED' : 'TIMEOUT')).catch(() => setExp('FAILED')); }} disabledReason={can(role, 'read_audit') ? undefined : REASON.read_audit}>Export CSV</Button>
    {exp === 'FAILED' ? <Banner tone="danger" title="The export failed">Try again.</Banner> : exp === 'TIMEOUT' ? <Banner tone="warning" title="The export is taking long">Try again in a few minutes.</Banner> : exp?.startsWith('https://') ? <p><a href={exp} rel="noreferrer">Download the export</a></p> : exp ? <p role="status">{exp}</p> : null}</Card>;
}
const r = (path: string, component: () => React.JSX.Element) => createRoute({ getParentRoute: () => rootRoute, path, component });
export const routeModule: RouteModule = { routes: [r('/w/$wsp/webhooks', Webhooks), r('/w/$wsp/webhooks/$id', WebhookDetail), r('/w/$wsp/audit', Audit)] };
export default routeModule;
export { Webhooks, WebhookDetail, Audit };
