import React, { useEffect, useState } from 'react';
import { Banner, Button, Chip, Input, Modal, Table, useToast } from '../ui/index.js';
import { RETRY_SCHEDULE_TEXT, SIGNATURE_FORMAT, WEBHOOK_EVENT_TYPES, groupEvents, verifySnippet } from './events.js';
import { detailText, validateUrl, type AuditEvent, type Delivery, type SecretVault } from './data.js';

/** The events as checkboxes grouped by prefix; what is checked is what is sent. */
export function EventPicker({ value, onChange }: { value: string[]; onChange(v: string[]): void }): React.JSX.Element {
  return <fieldset className="cc-card"><legend>Events</legend>{groupEvents().map((g) => <div key={g.group}><strong>{g.group}</strong>{g.types.map((t) => <label key={t} style={{ display: 'block' }}><input type="checkbox" checked={value.includes(t)} onChange={(e) => onChange(e.target.checked ? [...value, t] : value.filter((x) => x !== t))} /> {t}</label>)}</div>)}<p className="cc-help">{WEBHOOK_EVENT_TYPES.length} event types.</p></fieldset>;
}
export function WebhookForm({ onSubmit, disabledReason, testMode }: { onSubmit(v: { url: string; events: string[] }): void | Promise<void>; disabledReason?: string; testMode?: boolean }): React.JSX.Element {
  const [url, setUrl] = useState(''); const [events, setEvents] = useState<string[]>([]); const [error, setError] = useState<string>();
  return <form onSubmit={(e) => { e.preventDefault(); const bad = validateUrl(url, { testMode }); setError(bad); if (!bad && events.length) void onSubmit({ url: url.trim(), events }); }}><Input label="Endpoint address" value={url} error={error} onChange={(e) => { setUrl(e.target.value); setError(undefined); }} placeholder="https://example.com/hooks/centcom" autoComplete="off" /><EventPicker value={events} onChange={setEvents} /><Button variant="primary" type="submit" disabledReason={disabledReason ?? (events.length ? undefined : 'Pick at least one event.')}>Create endpoint</Button></form>;
}
/** The secret is shown once. The modal needs an explicit "I saved it" and clears the vault when it closes. */
export function SecretModal({ vault, rotated, onClose, overlapNote }: { vault: SecretVault; rotated?: boolean; onClose(): void; overlapNote?: string }): React.JSX.Element | null {
  const { toast } = useToast(); const secret = vault.get(); const [lang, setLang] = useState<'node' | 'python' | 'curl'>('node'); useEffect(() => () => vault.clear(), [vault]);
  if (secret === undefined) return null; const close = (): void => { vault.clear(); onClose(); };
  return <Modal open title={rotated ? 'New signing secret' : 'Signing secret'} onClose={() => undefined} dirty>
    <p>Copy it now. It is not shown again.</p><code data-testid="secret" className="cc-chip">{secret}</code> <Button onClick={() => void navigator.clipboard?.writeText(secret).then(() => toast('success', 'Copied.')).catch(() => toast('warning', 'Copy it by hand.'))}>Copy</Button>
    {rotated ? <Banner tone="info">{overlapNote ?? 'The old secret keeps working for 24 hours: deliveries carry both v1 signatures until then.'}</Banner> : null}
    <p className="cc-help">{SIGNATURE_FORMAT} (reject if older than 300 s)</p><label className="cc-label" htmlFor="snip">Check a delivery</label><select id="snip" className="cc-input" value={lang} onChange={(e) => setLang(e.target.value as typeof lang)}><option value="node">Node</option><option value="python">Python</option><option value="curl">curl</option></select><pre tabIndex={0}>{verifySnippet(lang)}</pre>
    <Button variant="primary" onClick={close}>I saved it</Button></Modal>;
}
export function DeliveriesTable({ rows, onRedeliver }: { rows: Delivery[]; onRedeliver(d: Delivery): void }): React.JSX.Element {
  return <><Table caption="Deliveries" rows={rows} rowKey={(d) => d.id} columns={[{ key: 'e', header: 'Event', cell: (d) => d.event_type }, { key: 's', header: 'Status', cell: (d) => <Chip tone={d.status === 'succeeded' || d.status === 'ok' ? 'success' : d.status === 'pending' ? 'info' : 'danger'}>{d.status}</Chip> }, { key: 'a', header: 'Attempt', cell: (d) => `${d.attempt} of 7` }, { key: 'h', header: 'Response', cell: (d) => d.response_status ?? '' }, { key: 't', header: 'Time', cell: (d) => d.created_at.replace('T', ' ').slice(0, 19) }, { key: 'x', header: 'Actions', cell: (d) => <Button variant="ghost" onClick={() => onRedeliver(d)}>Redeliver</Button> }]} /><p className="cc-help">{RETRY_SCHEDULE_TEXT}</p></>;
}
export function HealthChip({ status, enabled }: { status: string; enabled: boolean }): React.JSX.Element { return !enabled ? <Chip>disabled</Chip> : status === 'failing' ? <Chip tone="danger">failing</Chip> : <Chip tone="success">{status || 'healthy'}</Chip>; }
export function AuditTable({ rows }: { rows: AuditEvent[] }): React.JSX.Element {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  return <Table caption="Audit log" rows={rows} rowKey={(r) => r.id} columns={[{ key: 'at', header: 'When', cell: (r) => r.at.replace('T', ' ').slice(0, 19) }, { key: 'who', header: 'Who', cell: (r) => r.actor }, { key: 'act', header: 'Action', cell: (r) => r.action }, { key: 'res', header: 'Result', cell: (r) => r.result ?? '' }, { key: 'd', header: 'Details', cell: (r) => { const d = detailText(r.metadata, open[r.id]); return <>{d.text}{d.cut ? <Button variant="ghost" onClick={() => setOpen((o) => ({ ...o, [r.id]: true }))}>Show all</Button> : null}</>; } }]} />;
}
