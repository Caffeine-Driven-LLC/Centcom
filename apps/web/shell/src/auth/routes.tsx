import { createRoute, useNavigate } from '@tanstack/react-router';
import React, { useEffect, useState } from 'react';
import { rootRoute } from '../app/root.js';
import type { RouteModule } from '../app/types.js';
import { Banner, Button, Card } from '../ui/index.js';
import { AUTH_MESSAGES, AuthError } from './errors.js';
import { safeReturnTo } from './pkce.js';
import { callback, login, signOut, useAuth } from './runtime.js';

const NOTICES = { safety: 'Signed out for your safety', cookies_blocked: 'Your browser blocked sign-in cookies', expired: 'Your session ended', denied: AUTH_MESSAGES.access_denied } as const;
function Login(): React.JSX.Element {
  const { status, notice, viewerOnly } = useAuth(); const returnTo = safeReturnTo(new URLSearchParams(window.location.search).get('returnTo'));
  return <Card title="Sign in">{notice ? <Banner tone="warning">{NOTICES[notice]}</Banner> : null}{viewerOnly ? <Banner tone="info">This browser cannot make signing keys, so you will join sessions as a viewer.</Banner> : null}<Button variant="primary" disabled={status === 'authenticated'} onClick={() => void login(returnTo)}>Continue to sign in</Button></Card>;
}
function Callback(): React.JSX.Element {
  const nav = useNavigate(); const [error, setError] = useState<AuthError | undefined>();
  useEffect(() => { let on = true; void callback(new URL(window.location.href)).then((r) => { if (on) void nav({ to: r.returnTo as never }); }).catch((e: unknown) => { if (on) setError(e instanceof AuthError ? e : new AuthError('exchange_failed')); }); return () => { on = false; }; }, [nav]);
  return error ? <Card title="Sign in"><Banner tone="danger">{error.message}</Banner><Button variant="primary" onClick={() => void login('/')}>Try again</Button></Card> : <Card title="Signing you in…" />;
}
function Logout(): React.JSX.Element { const nav = useNavigate(); useEffect(() => { void signOut().then(() => nav({ to: '/login' as never })); }, [nav]); return <Card title="Signing you out…" />; }
const routes = [createRoute({ getParentRoute: () => rootRoute, path: '/login', component: Login }), createRoute({ getParentRoute: () => rootRoute, path: '/auth/callback', component: Callback }), createRoute({ getParentRoute: () => rootRoute, path: '/logout', component: Logout })];
export const routeModule: RouteModule = { routes };
export default routeModule;
