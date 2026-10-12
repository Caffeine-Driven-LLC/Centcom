import { LogIn, UserRound } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { Button, Dialog } from '../ui/shadcn/index.js';
import { useLocal } from './use-local.js';
import './shell.css';

const apiHost = (u: string): string => { try { return new URL(u).host; } catch { return u; } };
const initials = (n: string): string => (n.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('') || '?').toUpperCase();

/** The account button at the foot of the sidebar: "Sign in" for someone who is not, the name and plan for someone who is. Local sessions never need it. */
export function AccountChip(): React.JSX.Element | null {
  const { view, send, available } = useLocal(); const [open, setOpen] = useState(false); const a = view.account; const login = view.login;
  useEffect(() => { if (available) send({ t: 'account' }); }, [available, send]);
  useEffect(() => { if (login?.phase === 'done') setOpen(false); }, [login]);
  if (!available || !a) return null;
  const close = (o: boolean): void => { setOpen(o); if (!o && login?.phase === 'code') send({ t: 'cancelLogin' }); };
  return <>
    <button type="button" className="sb__account" onClick={() => setOpen(true)} title={a.signedIn ? `${a.me?.email ?? 'Signed in'}` : 'Sign in to share sessions'}>
      {a.signedIn ? <><span className="sb__avatar" aria-hidden="true">{initials(a.me?.name ?? '')}</span><span className="sb__name">{a.me?.name ?? 'Signed in'}</span><span className="sb__when">{a.me?.plan ?? ''}</span></> : <><LogIn aria-hidden="true" /><span className="sb__name">Sign in</span></>}
    </button>
    <Dialog open={open} onOpenChange={close} label="Account">
      <div className="acct">
        <h2 className="acct__title">{a.signedIn ? 'Your account' : 'Sign in to Centcom'}</h2>
        {a.signedIn ? <>
          <p className="acct__who"><UserRound aria-hidden="true" /><span><strong>{a.me?.name}</strong><br />{a.me?.email}</span></p>
          <dl className="acct__facts"><dt>Plan</dt><dd>{a.me?.plan ?? 'unknown'}</dd>{a.me?.workspace ? <><dt>Workspace</dt><dd>{a.me.workspace.name ?? a.me.workspace.id}</dd></> : null}<dt>Server</dt><dd>{apiHost(a.api)}</dd></dl>
          {a.offline ? <p className="acct__note">The server cannot be reached right now. Local sessions still work.</p> : null}
          {!a.persisted ? <p className="acct__note">This computer has no keychain, so you stay signed in only until the app closes.</p> : null}
          <div className="acct__actions"><Button variant="outline" onClick={() => send({ t: 'logout' })}>Sign out</Button><Button variant="ghost" onClick={() => close(false)}>Close</Button></div>
        </> : login?.phase === 'code' ? <>
          <p>{login.opened ? 'Your browser is open on the sign-in page.' : 'Open this address in a browser:'} Check that it shows this code, then allow it.</p>
          <p className="acct__code" aria-label="Sign-in code">{login.userCode}</p>
          {!login.opened ? <p className="acct__url">{login.url}</p> : null}
          <p className="acct__note">Waiting for you to approve… The code works for {Math.max(1, Math.round(login.expiresInS / 60))} minutes.</p>
          <div className="acct__actions"><Button variant="outline" onClick={() => send({ t: 'cancelLogin' })}>Cancel</Button></div>
        </> : <>
          <p>Signing in is only needed to share a session or join one. Everything on this computer works without it.</p>
          {login?.phase === 'failed' ? <p className="acct__error" role="alert">{login.error}</p> : null}
          <p className="acct__note">Server: {apiHost(a.api || 'api.centcom.dev')}</p>
          <div className="acct__actions"><Button onClick={() => send({ t: 'login' })}>Sign in with your browser</Button><Button variant="ghost" onClick={() => close(false)}>Not now</Button></div>
        </>}
      </div>
    </Dialog>
  </>;
}
