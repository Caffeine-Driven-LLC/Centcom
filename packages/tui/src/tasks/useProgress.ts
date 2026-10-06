import { useEffect, useState } from 'react';
import type { AgentBus } from '@centcom/agent';

/** The latest `progress` event for `id`: `value` is 0..1, or undefined when the total is unknown (or 0). */
export function progressOf(p: { value: number; total?: number; label: string }): { value?: number; label: string } {
  if (p.total === undefined) return { value: Math.min(1, Math.max(0, p.value)), label: p.label }; if (!p.total) return { label: p.label }; return { value: Math.min(1, Math.max(0, p.value / p.total)), label: p.label };
}
export function useProgress(bus: AgentBus, id: string): { value?: number; label: string } {
  const [s, set] = useState<{ value?: number; label: string }>({ label: '' });
  useEffect(() => { let pending: { value?: number; label: string } | undefined; let timer: NodeJS.Timeout | undefined; const off = bus.on('progress', (p) => { if (p.id !== id) return; pending = progressOf(p); if (!timer) timer = setTimeout(() => { timer = undefined; if (pending) set(pending); }, 80); }); return () => { off(); if (timer) clearTimeout(timer); }; }, [bus, id]);
  return s;
}
