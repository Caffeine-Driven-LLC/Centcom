import { Link2, Share2, Users } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { Badge, Button, Dialog } from '../ui/shadcn/index.js';
import { CopyButton } from './Markdown.js';
import { Person } from './SessionPanel.js';
import { openShare } from './share-event.js';
import type { LocalView } from './model.js';
import type { ClientMsg } from '../../../desktop/src/local/protocol.js';
import './shell.css';

const ROLE = { host: 'host', editor: 'can edit', viewer: 'view only' } as const;

/** The header button: "Share", or who is in the session when it is shared. */
export function ShareButton({ view }: { view: LocalView }): React.JSX.Element | null {
  const sh = view.sharing;
  if (!view.opened || view.state?.demo) return null;
  const live = sh?.state === 'live'; const others = (sh?.members ?? []).filter((m) => !m.you).length;
  return <Button variant={live ? 'secondary' : 'ghost'} size="sm" title={live ? 'Who is in this session, and how to invite people' : 'Share this session with other people'} onClick={openShare}><Share2 />{live ? (others ? `Shared · ${others}` : 'Shared') : 'Share'}</Button>;
}

/** Sharing the shown conversation: start it, invite people, decide what editors ask for, stop. */
export function ShareDialog({ view, send }: { view: LocalView; send(m: ClientMsg): void }): React.JSX.Element | null {
  const [open, setOpen] = useState(false); const [email, setEmail] = useState(''); const [mode, setMode] = useState<'command_post' | 'branch'>('command_post'); const sh = view.sharing; const account = view.account;
  useEffect(() => { const f = (): void => { setOpen(true); send({ t: 'account' }); }; window.addEventListener('centcom:share', f); return () => window.removeEventListener('centcom:share', f); }, [send]);
  const asking = !!sh?.confirm; useEffect(() => { if (asking) setOpen(true); }, [asking]); // the host's question must be seen
  if (!view.opened) return null;
  const live = sh?.state === 'live';
  const confirmBox = sh?.confirm ? <section className="shr__sec" role="alertdialog" aria-label={sh.confirm.title}><h3>{sh.confirm.title}</h3><p>{sh.confirm.text}</p><div className="acct__actions"><Button onClick={() => send({ t: 'shareConfirm', ok: true })}>Yes, share my login</Button><Button variant="ghost" onClick={() => send({ t: 'shareConfirm', ok: false })}>No, cancel</Button></div></section> : null;
  const wp = sh?.whoPays; const blockedBox = sh?.blocked ? <p className="acct__error" role="alert"><strong>{sh.blocked.title}.</strong> {sh.blocked.detail}</p> : null;
  return <Dialog open={open} onOpenChange={setOpen} label="Share this session">
    <div className="shr">
      <h2 className="acct__title">{live ? (sh?.joinedBranch ? 'You are in a shared session' : 'Shared session') : 'Share this session'}</h2>
      {!sh || sh.state === 'ended' ? <>
        <p>Nothing is uploaded except what the agents say and do, encrypted so that only the people in the session can read it. Your agent keeps running on this computer.</p>
        <fieldset className="shr__modes"><legend className="cc-label">How will you work together?</legend>
          <label className="shr__mode"><input type="radio" name="share-mode" checked={mode === 'command_post'} onChange={() => setMode('command_post')} /><span><strong>Only I run the agent</strong><small>Others watch it live and ask it for things; you approve what runs.</small></span></label>
          <label className="shr__mode"><input type="radio" name="share-mode" checked={mode === 'branch'} onChange={() => setMode('branch')} /><span><strong>Everyone runs their own agent</strong><small>Each person works on their own copy of the project with their own agent. You all see who is working on what, and get a warning before two agents change the same file.</small></span></label>
        </fieldset>
        {sh?.state === 'ended' ? <p className="acct__note">The last session has ended.</p> : null}
        {account && !account.signedIn ? <>
          <p className="acct__note">Sharing needs an account.</p>
          <div className="acct__actions"><Button onClick={() => { setOpen(false); window.dispatchEvent(new Event('centcom:account')); }}>Sign in</Button><Button variant="ghost" onClick={() => setOpen(false)}>Not now</Button></div>
        </> : <div className="acct__actions"><Button onClick={() => send({ t: 'share', mode })}>Start sharing</Button><Button variant="ghost" onClick={() => setOpen(false)}>Not now</Button></div>}
      </> : sh.state === 'starting' ? <>{confirmBox}<p>Starting the session…</p></> : sh.state === 'failed' ? <>
        <p className="acct__error" role="alert">{sh.error ?? 'Sharing did not start.'}</p>
        <div className="acct__actions">{sh.code === 'not_signed_in' ? <Button onClick={() => { setOpen(false); window.dispatchEvent(new Event('centcom:account')); }}>Sign in</Button> : <Button onClick={() => send({ t: 'share', mode })}>Try again</Button>}<Button variant="ghost" onClick={() => { send({ t: 'unshare' }); setOpen(false); }}>Close</Button></div>
      </> : <>
        {sh.mode === 'branch' ? <section className="shr__sec"><h3>Everyone runs their own agent</h3>
          <label className="shr__auto"><input type="checkbox" checked={sh.activity !== false} onChange={(e) => send({ t: 'shareActivity', on: e.target.checked })} />Show the team what my agent says and does</label>
          <p className="acct__note">{sh.activity !== false ? 'Teammates see my agent\'s messages and tool summaries. Its state, branch and the files it has open are always shared.' : 'Activity is not shared. Teammates still see my agent\'s state, branch and the files it has open.'}</p></section> : null}
        <section className="shr__sec"><h3><Link2 aria-hidden="true" />Join with the session id</h3>
          <p className="acct__note">People in your workspace ({sh.workspace ?? 'yours'}) enter it in Centcom (Join a session, or <code>centcom join</code>). Anyone else needs an invite (below).</p>
          <p className="shr__id"><code>{sh.sessionId}</code><CopyButton text={sh.sessionId ?? ''} label="Copy" /></p></section>
        <section className="shr__sec"><h3>Invite someone to this session</h3>
          <form className="shr__row" onSubmit={(e) => { e.preventDefault(); send({ t: 'shareInvite', ...(email.trim() ? { email: email.trim() } : {}) }); setEmail(''); }}><input className="cc-input" type="email" aria-label="E-mail address" placeholder="friend@example.com" value={email} onChange={(e) => setEmail(e.target.value)} /><Button type="submit" variant="outline" size="sm" disabled={!email.trim()}>Invite</Button></form>
          {sh.invite ? <p className="shr__id"><span>Invite link{sh.invite.email ? ` for ${sh.invite.email}` : ''}:</span><code>{sh.invite.url}</code><CopyButton text={sh.invite.url} label="Copy" /></p> : null}
          {sh.hint ? <p className="acct__note" role="status">{sh.hint}</p> : null}</section>
        <section className="shr__sec"><h3>Watch-only link</h3>
          {sh.link ? <p className="shr__id"><code className="shr__link">{sh.link.url}</code><CopyButton text={sh.link.url} label="Copy" /></p> : <Button variant="outline" size="sm" onClick={() => send({ t: 'shareLink' })}>Make a link</Button>}
          <p className="acct__note">Anyone with the link can watch, for an hour, without an account. Treat it like a password.</p></section>
        <section className="shr__sec"><h3><Users aria-hidden="true" />In this session</h3>
          <ul className="ps-list">{sh.members.map((m) => <Person key={m.id} name={m.you ? 'You' : m.name} slot={m.slot} sub={`${ROLE[m.role]}${m.online ? '' : ' · away'}`} />)}</ul></section>
        {confirmBox}{blockedBox}
        {wp ? <section className="shr__sec" aria-label="Whose account runs the agent"><h3>Whose account</h3>
          <p data-testid="runs-on">{sh.mode === 'branch' ? `Your agent runs on your own account · ${wp.provider}` : `Runs on you · ${wp.provider}`}</p>
          {sh.mode !== 'branch' && (wp.guests > 0 || wp.held) ? <p data-testid="guest-spend" className={wp.stale ? 'acct__note' : 'acct__error'}>{wp.paused || wp.held ? 'Guests paused' : `${wp.guests} ${wp.guests === 1 ? 'guest' : 'guests'} can spend your ${wp.provider === 'anthropic' ? 'Anthropic' : wp.provider === 'openai' ? 'OpenAI' : 'provider'} usage`}{wp.failed ? ' (could not pause on the server; guests are held on this computer anyway)' : ''} <Button size="sm" variant="outline" onClick={() => send({ t: 'sharePause', on: !(wp.paused || wp.held) })}>{wp.paused || wp.held ? 'Resume guests' : 'Pause guests'}</Button></p> : null}</section> : null}
        <section className="shr__sec"><h3>Asked for by others {sh.pending.length ? <Badge>{sh.pending.length}</Badge> : null}</h3>
          {sh.pending.length ? <ul className="shr__asks">{sh.pending.map((p) => <li key={p.item}><span><strong>{p.from}</strong>: {p.text}</span><span className="shr__btns"><Button size="sm" onClick={() => send({ t: 'shareDecide', item: p.item, decision: 'approve' })}>Run it</Button><Button size="sm" variant="ghost" onClick={() => send({ t: 'shareDecide', item: p.item, decision: 'reject' })}>No</Button></span></li>)}</ul> : <p className="acct__note">{sh.auto ? 'Requests from editors run without asking you.' : 'Nothing waiting. Requests from editors wait here for you.'}</p>}
          <label className="shr__auto"><input type="checkbox" checked={sh.auto} onChange={(e) => send({ t: 'shareAuto', on: e.target.checked })} />Run requests from editors without asking me</label></section>
        <div className="acct__actions"><Button variant="outline" onClick={() => { send({ t: 'unshare' }); setOpen(false); }}>Stop sharing</Button><Button variant="ghost" onClick={() => setOpen(false)}>Close</Button></div>
      </>}
    </div>
  </Dialog>;
}
