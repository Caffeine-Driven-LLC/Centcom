import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import React from 'react';
import { cn } from './utils.js';

export const TooltipProvider = TooltipPrimitive.Provider;
export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;
export function TooltipContent({ className, sideOffset = 6, ...props }: React.ComponentProps<typeof TooltipPrimitive.Content>): React.JSX.Element {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content sideOffset={sideOffset} className={cn('z-[80] rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md', className)} {...props} />
    </TooltipPrimitive.Portal>
  );
}
