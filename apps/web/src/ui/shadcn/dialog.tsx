import React, { useEffect } from 'react';
import { FocusTrap, useFocusReturn } from '../../a11y/focus.js';
import { cn } from './utils.js';

/** A modal in shadcn's style, without a library: a dimmed backdrop, focus kept inside, Esc or a click outside closes it, focus returns to what opened it. */
export function Dialog({ open, onOpenChange, label, className, children }: { open: boolean; onOpenChange(open: boolean): void; label: string; className?: string; children: React.ReactNode }): React.JSX.Element | null {
  useFocusReturn(open);
  useEffect(() => { if (!open) return; const k = (e: KeyboardEvent): void => { if (e.key === 'Escape') { e.stopPropagation(); onOpenChange(false); } }; window.addEventListener('keydown', k, true); return () => window.removeEventListener('keydown', k, true); }, [open, onOpenChange]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px]" onMouseDown={(e) => { if (e.target === e.currentTarget) onOpenChange(false); }}>
      <div role="dialog" aria-modal="true" aria-label={label} className={cn('absolute top-[16%] left-1/2 w-[min(640px,calc(100vw-32px))] -translate-x-1/2 overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-2xl', className)}>
        <FocusTrap>{children}</FocusTrap>
      </div>
    </div>
  );
}
