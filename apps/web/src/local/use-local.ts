import React, { createContext, useCallback, useContext, useEffect, useReducer } from 'react';
import type { ClientMsg, ServerMsg } from '../../../desktop/src/local/protocol.js';
import { emptyView, reduceLocal, type LocalView } from './model.js';

/** What the preload offers for the local session (absent in a plain browser tab). */
export interface LocalBridge { send(msg: unknown): void; onMessage(cb: (m: unknown) => void): () => void }
export const localBridge = (): LocalBridge | undefined => (typeof window === 'undefined' ? undefined : window.centcom?.local);
type LocalApi = { view: LocalView; send(m: ClientMsg): void; available: boolean };
/** One session store for the window: the sidebar, the palette and the session screen all read it. */
const LocalCtx = createContext<LocalApi | null>(null);
function useLocalStore(bridge: LocalBridge | undefined, active: boolean): LocalApi {
  const [view, dispatch] = useReducer(reduceLocal, undefined, emptyView);
  useEffect(() => { if (!bridge || !active) return; const off = bridge.onMessage((m) => dispatch(m as ServerMsg)); bridge.send({ t: 'hello' }); return off; }, [bridge, active]);
  const send = useCallback((m: ClientMsg) => bridge?.send(m), [bridge]);
  return { view, send, available: !!bridge };
}
export function LocalProvider({ children, bridge = localBridge() }: { children: React.ReactNode; bridge?: LocalBridge | undefined }): React.JSX.Element {
  const api = useLocalStore(bridge, true);
  return React.createElement(LocalCtx.Provider, { value: api }, children);
}
/** The view of this window's local session plus a send function. Inside a `LocalProvider` it is the shared one; otherwise it asks the main process for the launcher itself (tests, a bare screen). */
export function useLocal(bridge: LocalBridge | undefined = localBridge()): LocalApi {
  const shared = useContext(LocalCtx); const own = useLocalStore(bridge, shared === null);
  return shared ?? own;
}
