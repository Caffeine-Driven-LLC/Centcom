import { useEffect, useRef } from 'react';
import { useLocal } from './use-local.js';

/** The window title says when the agent is waiting for you or working, so a background window can be told apart in the task bar. */
export function titleFor(o: { opened?: string | undefined; waiting: number; busy: boolean }): string {
  const name = o.opened ? o.opened.replace(/\/+$/, '').split('/').pop() || o.opened : '';
  if (o.waiting > 0) return `(${o.waiting}) Needs you${name ? ` · ${name}` : ''} · Centcom`;
  if (o.busy) return `Working${name ? ` · ${name}` : ''} · Centcom`;
  return name ? `${name} · Centcom` : 'Centcom';
}
/** Everything waiting for a person, across the sessions that are alive (the shown one is counted from its own state, which is fresher). */
export function attention(view: { running: { dir: string; waiting: number; busy: boolean; ask?: string }[]; opened?: string | undefined; state?: { approvals: { summary: string }[]; busy: boolean } | undefined }): { waiting: number; busy: boolean; dir?: string | undefined; ask?: string | undefined } {
  const mine = view.state?.approvals.length ?? 0; let waiting = mine; let busy = !!view.state?.busy; let dir = mine ? view.opened : undefined; let ask = view.state?.approvals[0]?.summary;
  for (const r of view.running) { if (r.dir === view.opened) continue; waiting += r.waiting; busy ||= r.busy; if (!dir && r.waiting) { dir = r.dir; ask = r.ask; } }
  return { waiting, busy, dir, ask };
}
export function useAttentionTitle(): void {
  const { view } = useLocal(); const a = attention(view); const opened = view.opened;
  useEffect(() => { document.title = titleFor({ opened, waiting: a.waiting, busy: a.busy }); }, [opened, a.waiting, a.busy]);
}

/** What a desktop notification says when the agent needs a decision, or null when nothing new is waiting or the window is in front. */
export function notificationFor(o: { before: number; now: number; hidden: boolean; opened?: string | undefined; summary?: string | undefined }): { title: string; body: string } | null {
  if (!o.hidden || o.now <= o.before) return null;
  const name = o.opened ? o.opened.replace(/\/+$/, '').split('/').pop() || o.opened : 'your project';
  return { title: `Needs you · ${name}`, body: o.summary ? `Cento wants to: ${o.summary}` : 'Cento is waiting for your decision.' };
}
/** A system notification when a new approval is waiting and the window is in the background. Silently nothing where notifications are unavailable or refused. */
export function useApprovalNotice(): void {
  const { view } = useLocal(); const a = attention(view); const before = useRef(0);
  useEffect(() => {
    const n = notificationFor({ before: before.current, now: a.waiting, hidden: typeof document !== 'undefined' && document.hidden, opened: a.dir, summary: a.ask }); before.current = a.waiting;
    if (!n || typeof Notification === 'undefined') return;
    try { const show = (): void => { const x = new Notification(n.title, { body: n.body }); x.onclick = () => window.focus(); }; if (Notification.permission === 'granted') show(); else if (Notification.permission !== 'denied') void Notification.requestPermission().then((p) => { if (p === 'granted') show(); }); } catch { /* a notification is a courtesy */ }
  }, [a.waiting, a.dir, a.ask]);
}
