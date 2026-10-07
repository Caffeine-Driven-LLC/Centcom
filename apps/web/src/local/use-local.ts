import { useCallback, useEffect, useReducer } from 'react';
import type { ClientMsg, ServerMsg } from '../../../desktop/src/local/protocol.js';
import { emptyView, reduceLocal, type LocalView } from './model.js';

/** What the preload offers for the local session (absent in a plain browser tab). */
export interface LocalBridge { send(msg: unknown): void; onMessage(cb: (m: unknown) => void): () => void }
export const localBridge = (): LocalBridge | undefined => (typeof window === 'undefined' ? undefined : window.centcom?.local);
/** The view of this window's local session plus a send function. Asks the main process for the launcher once. */
export function useLocal(bridge: LocalBridge | undefined = localBridge()): { view: LocalView; send(m: ClientMsg): void; available: boolean } {
  const [view, dispatch] = useReducer(reduceLocal, undefined, emptyView);
  useEffect(() => { if (!bridge) return; const off = bridge.onMessage((m) => dispatch(m as ServerMsg)); bridge.send({ t: 'hello' }); return off; }, [bridge]);
  const send = useCallback((m: ClientMsg) => bridge?.send(m), [bridge]);
  return { view, send, available: !!bridge };
}
