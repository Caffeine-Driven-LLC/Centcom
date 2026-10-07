import type { Http } from '../workspace/data.js';
export interface PushEnv { Notification?: { permission: string; requestPermission(): Promise<string> }; serviceWorker?: { register(u: string): Promise<{ pushManager: { subscribe(o: unknown): Promise<{ toJSON(): unknown; unsubscribe(): Promise<boolean> }>; getSubscription(): Promise<{ unsubscribe(): Promise<boolean> } | null> } }> }; hasPush: boolean; vapidKey?: string }
export const pushSupported = (e: PushEnv): boolean => !!e.Notification && !!e.serviceWorker && e.hasPush;
/** Asks for permission once per session, and only when called from a click. The caller passes `fromClick: true` from its handler; anything else is refused. */
export class PushRegistrar {
  private asked = false; subscriptionId?: string;
  constructor(private readonly env: PushEnv, private readonly http: Http) {}
  async enable(o: { fromClick: boolean }): Promise<{ ok: true } | { ok: false; reason: 'no_gesture' | 'unsupported' | 'already_asked' | 'denied' | 'error' }> {
    if (!o.fromClick) return { ok: false, reason: 'no_gesture' }; if (!pushSupported(this.env)) return { ok: false, reason: 'unsupported' }; if (this.asked && this.env.Notification!.permission !== 'granted') return { ok: false, reason: 'already_asked' };
    try { if (this.env.Notification!.permission !== 'granted') { this.asked = true; if ((await this.env.Notification!.requestPermission()) !== 'granted') return { ok: false, reason: 'denied' }; }
      const reg = await this.env.serviceWorker!.register('/sw.js'); const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, ...(this.env.vapidKey ? { applicationServerKey: this.env.vapidKey } : {}) }); const r = await this.http.call('createPushSubscription', { body: { kind: 'web', keys: sub.toJSON() } }); this.subscriptionId = (r.data as { id?: string }).id; return { ok: true }; } catch { return { ok: false, reason: 'error' }; }
  }
  async disable(): Promise<boolean> { try { if (this.subscriptionId) await this.http.call('deletePushSubscription', { id: this.subscriptionId }); const reg = await this.env.serviceWorker?.register('/sw.js'); const s = await reg?.pushManager.getSubscription(); await s?.unsubscribe(); this.subscriptionId = undefined; return true; } catch { return false; } }
}
