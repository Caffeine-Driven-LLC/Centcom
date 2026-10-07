import { useSyncExternalStore } from 'react';
export interface Me { user: { id: string; email?: string; display_name?: string }; plan: unknown; active_workspace: unknown; ent: number | string }
export type AuthStatus = 'unknown' | 'anonymous' | 'authenticated';
export interface AuthState { status: AuthStatus; user?: Me; /** why the person was signed out, for the login screen */ notice?: 'safety' | 'cookies_blocked' | 'expired' | 'denied'; viewerOnly?: boolean }
/** The access token lives in this variable and nowhere else: not in storage, not in a cookie, not in a URL, not in a log. */
let accessToken: string | undefined; let expiresAt = 0; let state: AuthState = { status: 'unknown' }; const fns = new Set<() => void>();
export const peekToken = (): { token?: string; expiresAt: number } => ({ token: accessToken, expiresAt });
export function setToken(t: string | undefined, expiresInS?: number, now = Date.now()): void { accessToken = t; expiresAt = t && expiresInS ? now + expiresInS * 1000 : 0; }
export const getState = (): AuthState => state;
export function setState(next: Partial<AuthState> | AuthState, replace = false): void { state = replace ? (next as AuthState) : { ...state, ...next }; for (const f of [...fns]) f(); }
export const subscribe = (f: () => void): (() => void) => { fns.add(f); return () => { fns.delete(f); }; };
export function reset(): void { accessToken = undefined; expiresAt = 0; state = { status: 'unknown' }; }
export function useAuthState(): AuthState { return useSyncExternalStore(subscribe, getState, getState); }
