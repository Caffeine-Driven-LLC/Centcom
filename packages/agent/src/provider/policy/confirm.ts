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
  };
}
