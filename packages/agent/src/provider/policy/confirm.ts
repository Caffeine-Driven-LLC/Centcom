export interface ConfirmDeps { /** Shows the notice and resolves true when the host pressed `y`. */ ask(notice: ConfirmNotice): Promise<boolean>; audit(note: string, data: { engine: string }): void }
export interface ConfirmNotice { key: 'provider.cp_subscription.notice'; engine: string; sessionId: string }
/** The host's confirmation lives in memory for one session. It is never written to disk or sent on the wire; a new session asks again. */
export function createHostConfirmation(d: ConfirmDeps) {
  const confirmed = new Set<string>();
  return {
    has: (sessionId: string): boolean => confirmed.has(sessionId),
    async request(sessionId: string, engine: string): Promise<boolean> {
      if (confirmed.has(sessionId)) return true;
      const yes = await d.ask({ key: 'provider.cp_subscription.notice', engine, sessionId });
      if (yes) { confirmed.add(sessionId); d.audit('provider.cp_subscription.confirmed', { engine }); }
      return yes;
    },
    forget: (sessionId: string): void => { confirmed.delete(sessionId); },
    /** The host role moved to someone else: every confirmation is dropped and the new host is asked. */
    forgetAll: (): void => { confirmed.clear(); },
  };
}
export type HostConfirmation = ReturnType<typeof createHostConfirmation>;

export interface AuditNote { note: 'provider.cp_subscription.confirmed'; engine: string }
export interface RequestConfirmDeps { ui: { confirm(key: string, params: object): Promise<boolean> }; audit(e: AuditNote): void; sessionId: string }
const held = new Map<string, Set<string>>();
/**
 * Shows the notice through the host's own UI and holds a `y` for this session and engine, in memory only. A guest, a frame or a config file cannot
 * set it: the only way in is the `ui.confirm` answer of the local UI. Exactly one audit note per confirmation; an error or a refusal is a no.
 */
export async function requestHostConfirmation(d: RequestConfirmDeps, engine: string): Promise<boolean> {
  if (hostConfirmed(d.sessionId, engine)) return true;
  let yes = false; try { yes = (await d.ui.confirm('provider.cp_subscription.notice', { engine })) === true; } catch { yes = false; }
  if (!yes) return false;
  const set = held.get(d.sessionId) ?? new Set<string>(); set.add(engine); held.set(d.sessionId, set); d.audit({ note: 'provider.cp_subscription.confirmed', engine }); return true;
}
/** Has the host confirmed this engine in this session? */
export function hostConfirmed(sessionId: string, engine: string): boolean { return held.get(sessionId)?.has(engine) === true; }
/** Drops the confirmations of one session (it ended) or of all (the host role moved to someone else). */
export function dropHostConfirmations(sessionId?: string): void { if (sessionId === undefined) held.clear(); else held.delete(sessionId); }
