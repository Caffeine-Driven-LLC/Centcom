import React, { useEffect, useRef, useState } from 'react';
import { Banner, Button, Chip, Input, Modal, Table, useToast, type Column } from '../ui/index.js';
import { REASON, can, roleOptions, type WorkspaceRole } from './rbac.js';
import { changeRole, type Member } from './data.js';
export { useRetryAfter } from './retry.js';
import type { Http } from './data.js';

/** Typed confirmation for the destructive actions: the person types the name, the button repeats the verb, nothing closes it by itself, and there is no mascot. */
export function ConfirmByName({ open, verb, name, detail, onConfirm, onClose, busy }: { open: boolean; verb: string; name: string; detail?: string; onConfirm(): void; onClose(): void; busy?: boolean }): React.JSX.Element | null {
  const [typed, setTyped] = useState(''); useEffect(() => { if (!open) setTyped(''); }, [open]); const ok = typed === name;
  return <Modal open={open} title={verb} onClose={onClose} dirty={typed.length > 0}>{detail ? <p>{detail}</p> : null}<Input label={`Type ${name} to confirm`} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" /><div className="cc-row"><Button onClick={onClose}>Cancel</Button><Button variant="danger" disabledReason={ok ? undefined : `Type ${name} first.`} disabled={busy} onClick={() => { if (ok) onConfirm(); }}>{verb}</Button></div></Modal>;
}
export const SeatBanner = ({ billingHref }: { billingHref: string }): React.JSX.Element => <Banner tone="warning" title="No free seats">All seats are in use. <a href={billingHref}>See billing</a></Banner>;
/** The members table: a role select that goes back to the old value (within 300 ms) when the server refuses, with the reason in a toast. */
export function MembersTable({ members, me, myRole, http, ws, onChanged, onRemove, onTransfer }: { members: Member[]; /** the signed-in user's id (from /v1/me) */ me: string; myRole: WorkspaceRole | undefined; http: Http; ws: string; onChanged(): void; onRemove(m: Member): void; onTransfer(m: Member): void }): React.JSX.Element {
  const { toast } = useToast(); const [shown, setShown] = useState<Record<string, string>>({}); const timers = useRef<number[]>([]); useEffect(() => () => { for (const t of timers.current) clearTimeout(t); }, []);
  const columns: Column<Member>[] = [
    { key: 'name', header: 'Name', cell: (m) => m.user?.display_name ?? m.user?.email ?? m.id },
    { key: 'role', header: 'Role', cell: (m) => { const self = !!me && m.user?.id === me; const opts = roleOptions(myRole, { role: m.role as WorkspaceRole, self }); const v = shown[m.id] ?? m.role; return opts.length ? <select aria-label={`Role of ${m.user?.display_name ?? m.id}`} className="cc-input" value={v} onChange={(e) => { const next = e.target.value; setShown((s) => ({ ...s, [m.id]: next })); void changeRole(http, ws, m.id, next).then((r) => { if (r.ok) { onChanged(); return; } toast('danger', r.reason === 'forbidden' ? 'You are not allowed to change that role.' : r.reason === 'rate_limited' ? `Too many requests. Try again in ${r.retryAfterS ?? 1}s.` : 'The role could not be changed.'); timers.current.push(window.setTimeout(() => setShown((s) => { const { [m.id]: _gone, ...rest } = s; return rest; }), 0)); }); }}>{[...new Set([m.role, ...opts])].map((r) => <option key={r} value={r}>{r}</option>)}</select> : <Chip>{m.role}</Chip>; } },
    { key: 'joined', header: 'Joined', cell: (m) => (m.joined_at ?? m.created_at ?? '').slice(0, 10) },
    { key: 'actions', header: 'Actions', cell: (m) => { const self = !!me && m.user?.id === me; return <>{(can(myRole, 'remove_member') && m.role !== 'owner') || (self && m.role !== 'owner') ? <Button variant="ghost" onClick={() => onRemove(m)}>{self ? 'Leave' : 'Remove'}</Button> : null}{can(myRole, 'transfer_ownership') && !self ? <Button variant="ghost" onClick={() => onTransfer(m)}>Make owner</Button> : null}</>; } },
  ];
  return <Table caption="Members" rows={members} rowKey={(m) => m.id} columns={columns} />;
}
export { REASON };
