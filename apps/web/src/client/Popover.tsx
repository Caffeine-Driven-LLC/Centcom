import { useEffect, useRef, type ReactNode } from 'react';

/** Closes on outside click and Escape; the trigger lives outside, the panel inside. */
export function Popover({ open, onClose, children, align = 'left', up = false }: { open: boolean; onClose: () => void; children: ReactNode; align?: 'left' | 'right'; up?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node) && !(e.target as HTMLElement).closest('[data-popover-trigger]')) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', down); document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key); };
  }, [open, onClose]);
  if (!open) return null;
  return <div ref={ref} className={`popover ${align} ${up ? 'up' : ''}`} role="menu">{children}</div>;
}
