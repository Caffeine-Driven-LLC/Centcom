import React from 'react';
import { cn } from './utils.js';

/** A round initial on one of the five presence colours (`slot` 0 to 4). */
export function Avatar({ name, slot = 0, className }: { name: string; slot?: number; className?: string }): React.JSX.Element {
  return <span data-slot="avatar" data-colour={slot % 5} className={cn('sc-avatar', className)} aria-hidden="true">{[...name.trim()][0]?.toUpperCase() ?? '?'}</span>;
}
