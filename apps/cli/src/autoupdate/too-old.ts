/** A service that says "this Centcom is too old" (HTTP 426, error code `client_too_old`, WebSocket close 4426, or `/v1/status.min_client_version` above our version)
 *  blocks the hosted features only. Local sessions and LAN keep working: this module decides which modes the blocking screen lets through. */
import { isClientTooOld } from '@centcom/protocol';
import { packageManagerCommand, type InstallMethod } from './install-method.js';

export type StartMode = 'hosted' | 'lan' | 'local';
/** Anything a call can fail with, or a close event: is it the "too old" signal? */
export function isTooOldSignal(x: unknown): boolean {
  if (typeof x === 'number') return x === 426 || x === 4426;
  if (!x || typeof x !== 'object') return false;
  const o = x as { status?: unknown; code?: unknown; closeCode?: unknown; cause?: unknown };
  if (o.status === 426 || o.code === 'client_too_old' || o.closeCode === 4426 || o.code === 4426) return true;
  return o.cause !== undefined && o.cause !== x ? isTooOldSignal(o.cause) : false;
}
/** `/v1/status` carries the oldest client the service still serves. */
export const belowMinimum = (version: string, status: { min_client_version?: unknown } | undefined): boolean => typeof status?.min_client_version === 'string' && isClientTooOld(version, status.min_client_version);
/** Hosted features are blocked; LAN and local carry on. */
export function modeAllowed(mode: StartMode, tooOld: boolean): boolean { return !tooOld || mode !== 'hosted'; }
export interface TooOldScreen { title: string; lines: string[]; blocks: StartMode[]; allows: StartMode[] }
/** The words of the blocking screen: what is blocked, what still works, and the exact way to update for this install. */
export function tooOldScreen(o: { version: string; min?: string; method: InstallMethod }): TooOldScreen {
  const cmd = packageManagerCommand(o.method) ?? (o.method === 'standalone' ? 'centcom update' : undefined);
  return {
    title: 'This version of Centcom is too old for the service',
    lines: [`You have ${o.version}${o.min ? `; the service needs ${o.min} or newer` : ''}. Hosted sessions, sharing and sync are paused until you update.`, 'Local work and LAN sessions still run as usual.', cmd ? `Update with: ${cmd}` : 'You are running from a source checkout: pull the latest and rebuild.'],
    blocks: ['hosted'], allows: ['lan', 'local'],
  };
}
