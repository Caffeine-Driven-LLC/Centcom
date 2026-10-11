import { useEffect } from 'react';
import { useLocal } from './use-local.js';

/** The window title says when the agent is waiting for you or working, so a background window can be told apart in the task bar. */
export function titleFor(o: { opened?: string | undefined; waiting: number; busy: boolean }): string {
  const name = o.opened ? o.opened.replace(/\/+$/, '').split('/').pop() || o.opened : '';
  if (o.waiting > 0) return `(${o.waiting}) Needs you${name ? ` · ${name}` : ''} · Centcom`;
  if (o.busy) return `Working${name ? ` · ${name}` : ''} · Centcom`;
  return name ? `${name} · Centcom` : 'Centcom';
}
export function useAttentionTitle(): void {
  const { view } = useLocal(); const waiting = view.state?.approvals.length ?? 0; const busy = !!view.state?.busy; const opened = view.opened;
  useEffect(() => { document.title = titleFor({ opened, waiting, busy }); }, [opened, waiting, busy]);
}
