/** The inbox client: the list, unread count, read/read-all, polling with backoff, and OS notifications for new items. */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { HttpClient, HttpClock } from '../http/types.js';
import { getPreferences, allowedByQuietHours, osEnabled, type LocalOs, type NotificationPreferences } from './preferences.js';
import { render } from './render.js';
import type { OsNotifier } from './os-notifier.js';

export interface Notification {
  id: string; created_at: string; read_at: string | null; category: string; title_key: string; body_key: string; priority: 'low' | 'normal' | 'high';
  params?: Record<string, unknown>; action?: { type: string; deeplink?: string };
}
export const POLL_MS = 60_000; export const BACKOFF_MS = [60_000, 120_000, 300_000] as const; export const SEEN_KEEP = 200;
type Events = { new: (n: Notification) => void; unread: (count: number) => void; error: (e: Error) => void };

export interface NotificationsOptions {
  http: HttpClient; clock: HttpClock; os: OsNotifier; stateDir: string; pollMs?: number;
  /** Polling and OS notices stay off while this says false (logged out or offline). */ active?: () => boolean;
  /** `os` switches kept in the client config. */ localOs?: () => LocalOs;
}

export class NotificationsClient {
  private unread = 0; private fails = 0; private timer: unknown; private running = false; private busy = false; private seen: string[] = []; private loaded = false; private firstPoll = true;
  private prefs?: NotificationPreferences; private readonly h: { [K in keyof Events]: Events[K][] } = { new: [], unread: [], error: [] };
  constructor(private readonly o: NotificationsOptions) {}
  on<K extends keyof Events>(e: K, f: Events[K]): () => void { (this.h[e] as Events[K][]).push(f); return () => { const a = this.h[e] as Events[K][]; const i = a.indexOf(f); if (i >= 0) a.splice(i, 1); }; }
  private emit<K extends keyof Events>(e: K, ...a: Parameters<Events[K]>): void { for (const f of [...this.h[e]] as ((...x: Parameters<Events[K]>) => void)[]) { try { f(...a); } catch { /* a listener must not break polling */ } } }
  unreadCount(): number { return this.unread; }

  /** Every item, newest first, using the service's opaque cursors (200 per page at most). */
  list(o: { unread?: boolean; signal?: AbortSignal } = {}): AsyncIterable<Notification> {
    return this.o.http.paginate('listNotifications', (o.unread ? { query: { unread: true } } : {}) as never, { limit: 200, signal: o.signal }) as unknown as AsyncIterable<Notification>;
  }
  /** One request; the count drops at once and is put back if the request fails. */
  async markRead(id: string): Promise<void> {
    const before = this.unread; this.setUnread(Math.max(0, this.unread - 1));
    try { await this.o.http.call('markNotificationRead', { path: { id } } as never); } catch (e) { this.setUnread(before); this.emit('error', e as Error); throw e; }
  }
  async markAllRead(): Promise<void> {
    const before = this.unread; this.setUnread(0);
    try { await this.o.http.call('markAllNotificationsRead', {} as never); } catch (e) { this.setUnread(before); this.emit('error', e as Error); throw e; }
  }
  private setUnread(n: number): void { if (n !== this.unread) { this.unread = n; this.emit('unread', n); } }

  start(): void { if (this.running) return; this.running = true; this.schedule(0); }
  stop(): void { this.running = false; if (this.timer !== undefined) this.o.clock.clearTimeout(this.timer as never); this.timer = undefined; }
  /** Look now (a WebSocket notice said something changed). */
  refresh(): Promise<void> { return this.poll(); }
  private nextDelay(): number { return this.fails === 0 ? (this.o.pollMs ?? POLL_MS) : BACKOFF_MS[Math.min(this.fails, BACKOFF_MS.length) - 1]!; }
  private schedule(ms: number): void { if (!this.running) return; this.timer = this.o.clock.setTimeout(() => { void this.poll().finally(() => this.schedule(this.nextDelay())); }, ms); }

  async poll(): Promise<void> {
    if (this.busy || (this.o.active && !this.o.active())) return; this.busy = true;
    try {
      await this.loadSeen(); const fresh: Notification[] = []; let unread = 0;
      for await (const n of this.list({ unread: true })) { unread++; if (!this.seen.includes(n.id)) fresh.push(n); if (unread >= 1000) break; }
      this.fails = 0; this.setUnread(unread);
      const first = this.firstPoll; this.firstPoll = false;
      for (const n of fresh.reverse()) { this.remember(n.id); this.emit('new', n); if (!first || n.priority === 'high') await this.maybeShowOs(n); }
      if (fresh.length) await this.saveSeen();
    } catch (e) { this.fails = Math.min(this.fails + 1, BACKOFF_MS.length); this.emit('error', e as Error); } finally { this.busy = false; }
  }
  private async maybeShowOs(n: Notification): Promise<void> {
    try {
      this.prefs ??= (await getPreferences(this.o.http)).preferences;
      if (!osEnabled(n.category, this.o.localOs?.() ?? {}, this.prefs)) return; if (!allowedByQuietHours(n, this.prefs.quiet_hours, this.o.clock.now())) return;
      const t = render(n); await this.o.os.show({ title: t.title, body: t.body, sound: n.priority === 'high' });
    } catch { /* showing is best effort */ }
  }
  private remember(id: string): void { this.seen.push(id); if (this.seen.length > SEEN_KEEP) this.seen.splice(0, this.seen.length - SEEN_KEEP); }
  private get file(): string { return join(this.o.stateDir, 'notifications-seen.json'); }
  private async loadSeen(): Promise<void> { if (this.loaded) return; this.loaded = true; try { const a = JSON.parse(await readFile(this.file, 'utf8')) as unknown; if (Array.isArray(a)) this.seen = a.filter((x): x is string => typeof x === 'string').slice(-SEEN_KEEP); else this.firstPoll = true; } catch { /* first run */ } if (this.seen.length) this.firstPoll = false; }
  private async saveSeen(): Promise<void> { try { await mkdir(this.o.stateDir, { recursive: true, mode: 0o700 }); const t = `${this.file}.tmp`; await writeFile(t, JSON.stringify(this.seen), { mode: 0o600 }); await rename(t, this.file); } catch { /* losing it only risks one repeated notice */ } }
}
