import type { MemberId } from '../../events/index.js';
import type { ProviderId } from '../../types.js';

export interface RosterEntry { id: MemberId; role: 'host' | 'editor' | 'viewer'; connected: boolean }
export interface GuestSpendDeps {
  /** The roster; may throw while reconnecting (the last known count is kept). */
  roster(): RosterEntry[]; hostId: MemberId; provider: ProviderId;
  /** Implemented by the session lanes with `control.policy` (locked: true) and by holding unclaimed guest queue items. */
  setGuestsPaused(paused: boolean): Promise<void>;
}
/**
 * Host-side spend control. `count()` is the connected editors other than the host. `pause()` also holds guest queue items locally, so if the
 * session call fails (offline, not host) the state stays as it was for the UI (`lastError()` says so) but nothing new is claimed: fail safe toward not spending.
 */
export function createGuestSpendControl(d: GuestSpendDeps) {
  let paused = false; let heldLocally = false; let lastCount = 0; let stale = false; let failed = false; const subs = new Set<() => void>();
  const emit = () => { for (const h of [...subs]) { try { h(); } catch { /* a listener must not break the control */ } } };
  function count(): number { try { lastCount = d.roster().filter((m) => m.role === 'editor' && m.connected && m.id !== d.hostId).length; stale = false; } catch { stale = true; } return lastCount; }
  async function set(next: boolean): Promise<void> {
    if (paused === next && !failed) return; if (next) heldLocally = true; failed = false;
    try { await d.setGuestsPaused(next); paused = next; heldLocally = next; } catch { failed = true; /* paused stays as it was; heldLocally stays true when pausing */ }
    emit();
  }
  return {
    count, paused: (): boolean => paused,
    /** True while guest items must not be claimed: paused, or a pause that could not be sent. */
    held: (): boolean => paused || heldLocally,
    /** The roster could not be read last time, so `count()` is the last known value (show it dimmed). */
    stale: (): boolean => stale,
    /** The last pause or resume failed: show `provider.pause_failed`. */
    lastError: (): boolean => failed,
    pause: () => set(true), resume: () => set(false),
    on(e: 'change', h: () => void): () => void { if (e !== 'change') return () => undefined; subs.add(h); return () => { subs.delete(h); }; },
  };
}
export type GuestSpendControl = ReturnType<typeof createGuestSpendControl>;
