import { Crown, Mail, Sparkles, Trash2, Users } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { Badge, Button, Dialog } from '../ui/shadcn/index.js';
import { useLocal } from './use-local.js';
import './shell.css';

const ROLES = ['admin', 'member', 'billing', 'guest'] as const;
const WORDS: Record<string, string> = { owner: 'Owner', admin: 'Admin', member: 'Member', billing: 'Billing', guest: 'Guest' };
const day = (iso: string): string => { const t = Date.parse(iso); return Number.isFinite(t) ? new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : ''; };

/** The people in the signed-in person's workspace: members and their roles, invites still open, plan and seats, and the Upgrade button when the plan has no relay. */
export function TeamDialog({ open, onOpenChange }: { open: boolean; onOpenChange(open: boolean): void }): React.JSX.Element {
  const { view, send } = useLocal(); const t = view.team; const team = t?.team; const [email, setEmail] = useState(''); const [role, setRole] = useState<(typeof ROLES)[number]>('member'); const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) send({ t: 'team' }); }, [open, send]);
  useEffect(() => { setBusy(false); if (t?.done) setEmail(''); }, [t]);
  useEffect(() => { if (view.upgradeUrl && open) window.open(view.upgradeUrl, '_blank', 'noopener'); }, [view.upgradeUrl]); // the desktop opens https links in the browser
  const act = (m: Parameters<typeof send>[0]): void => { setBusy(true); send(m); };
  const manage = !!team?.canManage;
  return <Dialog open={open} onOpenChange={onOpenChange} label="Team" className="team-dialog">
    <div className="team">
      <h2 className="acct__title"><Users aria-hidden="true" /> {team?.workspace.name ?? 'Your team'}</h2>
      {!team && !t?.error ? <p className="acct__note">Loading…</p> : null}
      {t?.error ? <p className="acct__error" role="alert">{t.error}</p> : null}
      {t?.done ? <p className="acct__ok" role="status">{t.done}{t.link ? <> Send this link if the mail does not arrive: <span className="acct__url">{t.link}</span></> : null}</p> : null}
      {team ? <>
        <p className="team__plan"><Badge>{team.plan}</Badge> <span>{team.seats.used} of {team.seats.max ?? 'unlimited'} seats used</span>
          {!team.relayAccess ? <Button size="sm" onClick={() => send({ t: 'upgrade' })}><Sparkles aria-hidden="true" /> Upgrade to share over the internet</Button> : null}</p>
        {!team.relayAccess ? <p className="acct__note">Your plan works on this computer and your own network. Sharing a session over the internet needs Pro or Team. The person who hosts pays; people who join do not.</p> : null}
        <h3 className="team__h">People</h3>
        <ul className="team__list" aria-label="Members">
          {team.members.map((m) => <li key={m.id} className="team__row">
            <span className="sb__avatar" aria-hidden="true">{(m.name[0] ?? '?').toUpperCase()}</span>
            <span className="team__who"><strong>{m.name}{m.you ? ' (you)' : ''}</strong>{m.email ? <small>{m.email}</small> : null}</span>
            {m.role === 'owner' ? <span className="team__owner"><Crown aria-hidden="true" /> Owner</span>
              : manage && !m.you ? <>
                <select className="team__role" aria-label={`Role of ${m.name}`} value={m.role} onChange={(e) => act({ t: 'teamRole', member: m.id, role: e.target.value as (typeof ROLES)[number] })} disabled={busy}>{ROLES.map((r) => <option key={r} value={r}>{WORDS[r]}</option>)}</select>
                <Button variant="ghost" size="icon" aria-label={`Remove ${m.name}`} title="Remove from the workspace" onClick={() => act({ t: 'teamRemove', member: m.id })} disabled={busy}><Trash2 aria-hidden="true" /></Button>
              </> : <span className="team__role-ro">{WORDS[m.role] ?? m.role}</span>}
          </li>)}
        </ul>
        {team.invites.length ? <><h3 className="team__h">Waiting to join</h3>
          <ul className="team__list" aria-label="Pending invites">{team.invites.map((i) => <li key={i.id} className="team__row"><Mail aria-hidden="true" /><span className="team__who"><strong>{i.email ?? 'A link invite'}</strong><small>{WORDS[i.role] ?? i.role} · expires {day(i.expiresAt)}</small></span>
            {manage ? <Button variant="ghost" size="sm" onClick={() => act({ t: 'teamRevoke', invite: i.id })} disabled={busy}>Revoke</Button> : null}</li>)}</ul></> : null}
        {manage ? <form className="team__invite" onSubmit={(e) => { e.preventDefault(); if (email.trim()) act({ t: 'teamInvite', email: email.trim(), role }); }}>
          <h3 className="team__h">Invite someone to the whole workspace</h3>
          <div className="team__invite-row"><input type="email" aria-label="E-mail address" placeholder="name@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
            <select aria-label="Role" value={role} onChange={(e) => setRole(e.target.value as (typeof ROLES)[number])}>{ROLES.map((r) => <option key={r} value={r}>{WORDS[r]}</option>)}</select>
            <Button type="submit" disabled={busy || !email.trim()}>Invite</Button></div>
          <p className="acct__note">A workspace member uses a seat. To bring one person into one session without a seat, use Share in that session.</p>
        </form> : <p className="acct__note">Only an owner or admin can change the team.</p>}
      </> : null}
      <div className="acct__actions"><Button variant="ghost" onClick={() => onOpenChange(false)}>Close</Button></div>
    </div>
  </Dialog>;
}
