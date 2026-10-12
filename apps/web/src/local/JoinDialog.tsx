import { LogIn } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { Button, Dialog } from '../ui/shadcn/index.js';
import type { LocalView } from './model.js';
import type { ClientMsg } from '../../../desktop/src/local/protocol.js';
import './shell.css';

export const openJoin = (): void => { window.dispatchEvent(new Event('centcom:join')); };

/** "Join a session": paste a session id, an invite link or a watch-only link. */
export function JoinDialog({ view, send, onJoin }: { view: LocalView; send(m: ClientMsg): void; onJoin?(): void }): React.JSX.Element {
  const [open, setOpen] = useState(false); const [input, setInput] = useState('');
  useEffect(() => { const f = (): void => setOpen(true); window.addEventListener('centcom:join', f); return () => window.removeEventListener('centcom:join', f); }, []);
  const go = (): void => { const t = input.trim(); if (!t) return; send({ t: 'join', input: t }); setInput(''); setOpen(false); onJoin?.(); };
  const signedIn = view.account?.signedIn !== false;
  return <Dialog open={open} onOpenChange={setOpen} label="Join a session">
    <form className="shr" onSubmit={(e) => { e.preventDefault(); go(); }}>
      <h2 className="acct__title">Join a session</h2>
      <p>Paste the link someone sent you: an invite, a watch-only link, or the session id of a session in your workspace.</p>
      <input className="cc-input" aria-label="Link or session id" placeholder="https://centcom.dev/i/…  or  ses_…" value={input} onChange={(e) => setInput(e.target.value)} autoFocus />
      {!signedIn ? <p className="acct__note">Invites and session ids need you to sign in first (a watch-only link does not).</p> : null}
      <div className="acct__actions"><Button type="submit" disabled={!input.trim()}><LogIn />Join</Button><Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button></div>
    </form>
  </Dialog>;
}
