import type { PConflictDetected } from '@centcom/protocol';
import type { FileLockPayload, LockClient, LockTransport } from './types.js';

/** What a shared session gives the lock client: a way to send lock events, the session's keyed path hash, and the wire ids of local agents. */
export interface LockLink {
  publish(p: { clear: FileLockPayload; secret: { path: string } }): void;
  ready(): boolean;
  pathMac(path: string): string;
  wireId(localId: string): string;
  /** a conflict between a local agent and a teammate's agent was noticed here */
  conflict?(p: PConflictDetected): void;
}

/**
 * The lock client of a runtime is built once, before anything is shared. The hub is the part of it that a session plugs into later
 * and unplugs again: while nothing is attached, lock events are not sent (and nothing is queued).
 */
export interface LockHub {
  readonly transport: LockTransport;
  readonly pathMac: (path: string) => string | undefined;
  readonly wireId: (localId: string) => string;
  readonly onConflict: (p: PConflictDetected) => void;
  /** The runtime sets this once it has built the client. */
  client?: LockClient;
  attach(link: LockLink): () => void;
  /** A `file.lock` event from a teammate's agent (never your own echo). */
  remote(evt: FileLockPayload): void;
  get attached(): boolean;
}

export function createLockHub(): LockHub {
  let link: LockLink | undefined;
  const hub: LockHub = {
    transport: { publish: (p) => link?.publish(p), ready: () => !!link && link.ready() },
    pathMac: (path) => { try { return link?.pathMac(path); } catch { return undefined; } },
    wireId: (id) => { try { return link?.wireId(id) ?? id; } catch { return id; } },
    onConflict: (p) => { try { link?.conflict?.(p); } catch { /* a listener must not break the lock client */ } },
    attach(l) { link = l; hub.client?.flush(); return () => { if (link === l) link = undefined; }; },
    remote(evt) { hub.client?.onRemoteLock(evt); },
    get attached() { return !!link; },
  };
  return hub;
}
