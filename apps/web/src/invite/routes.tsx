import { createRoute, useNavigate, useParams } from '@tanstack/react-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { rootRoute } from '../app/root.js';
import type { RouteModule } from '../app/types.js';
import { login, useAuth } from '../auth/runtime.js';
import { useHttp } from '../lib/http-context.js';
import { Banner, Button, Card, Skeleton } from '../ui/index.js';
import { useRetryAfter } from '../workspace/retry.js';
import { appUrl, isToken } from './deeplink.js';
import { HELP_TEXT, INVALID_TEXT, acceptInvite, joinViaShare, previewInvite, type Opener, type Preview } from './flow.js';
import { KeyHolder, takeFragmentKey } from './fragment.js';

/** The sealed-box opening belongs to the crypto lane (C056); until it is wired the bundle is kept for the session page. */
let opener: Opener = async () => undefined; export const setBundleOpener = (o: Opener): void => { opener = o; };
const Invalid = (): React.JSX.Element => <Card title="Invite"><Banner tone="warning" title={INVALID_TEXT}>{HELP_TEXT}</Banner></Card>;
function Invite({ kind }: { kind: 'join' | 'invite' }): React.JSX.Element {
  const { token } = useParams({ strict: false }) as { token: string }; const http = useHttp(); const nav = useNavigate(); const { status } = useAuth();
  const key = useRef<KeyHolder | undefined>(undefined); const [p, setP] = useState<Preview>(); const [state, setState] = useState<'loading' | 'ready' | 'invalid' | 'error' | 'accepting' | 'waiting'>('loading'); const [handoff, setHandoff] = useState(false);
  useEffect(() => { if (!key.current && typeof window !== 'undefined') key.current = takeFragmentKey(window.location, window.history); const ac = new AbortController(); void previewInvite(http, token, ac.signal).then((r) => { if (r.state === 'ready') { setP(r.preview); setState('ready'); } else setState(r.state); }); return () => { ac.abort(); }; }, [http, token]);
  useEffect(() => () => key.current?.zero(), []);
  if (!isToken(token) || state === 'invalid') return <Invalid />; if (state === 'loading') return <Skeleton lines={3} />; if (state === 'error') return <Banner tone="danger">The invite could not be loaded. Try again in a moment.</Banner>;
  const what = kind === 'join' ? `Join ${p?.inviter_name ?? 'this'}'s session?` : `Join the workspace ${p?.workspace_name ?? ''}?`;
  return <Card title={what}><p>{kind === 'join' ? 'Invited by' : 'Workspace'} <strong>{kind === 'join' ? p?.inviter_name : p?.workspace_name}</strong> · role {p?.role} · until {p?.expires_at.slice(0, 10)}</p>
    <div><Button onClick={() => { setHandoff(true); window.location.assign(appUrl({ kind, token })); }}>Open in Centcom</Button> {status === 'authenticated' ? <Button variant="primary" disabledReason={state === 'accepting' ? 'Working on it…' : undefined} onClick={() => { setState('accepting'); void acceptInvite(http, token, { key: key.current ?? new KeyHolder(), open: opener, sleep: (ms) => new Promise((r) => setTimeout(r, ms)), signedIn: true }).then((r) => { if (r.state === 'joined' || r.state === 'waiting_for_key') { if (r.state === 'waiting_for_key') setState('waiting'); void nav({ to: (kind === 'join' ? '/workspaces' : '/workspaces') as never }); } else setState(r.state === 'invalid' ? 'invalid' : 'error'); }); }}>Join in the browser</Button> : <Button variant="primary" onClick={() => void login(window.location.pathname)}>Sign in to join</Button>}</div>
    {handoff ? <p role="status">If Centcom did not open, you can still join here.</p> : null}{state === 'waiting' ? <p role="status">Waiting for the host to let you in.</p> : null}</Card>;
}
function Share(): React.JSX.Element {
  const { token } = useParams({ strict: false }) as { token: string }; const http = useHttp(); const nav = useNavigate(); const retry = useRetryAfter(); const [state, setState] = useState<'idle' | 'working' | 'invalid' | 'error'>('idle');
  if (!isToken(token) || state === 'invalid') return <Invalid />;
  return <Card title="Watch a session"><p>You can read along as a guest, without an account.</p><Button variant="primary" disabledReason={retry.reason ?? (state === 'working' ? 'Working on it…' : undefined)} onClick={() => { setState('working'); void joinViaShare(http, token).then((r) => { if (r.state === 'joined') void nav({ to: '/workspaces' as never }); else if (r.state === 'rate_limited') { retry.arm(r.retryAfterS); setState('idle'); } else setState(r.state); }); }}>Join as a viewer</Button>{state === 'error' ? <Banner tone="danger">That did not work. Try again.</Banner> : null}</Card>;
}
void useMemo;
const r = (path: string, component: () => React.JSX.Element) => createRoute({ getParentRoute: () => rootRoute, path, component });
export const routeModule: RouteModule = { routes: [r('/j/$token', () => <Invite kind="join" />), r('/i/$token', () => <Invite kind="invite" />), r('/g/$token', Share)] };
export default routeModule;
