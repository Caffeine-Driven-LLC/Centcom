import * as AvatarPrimitive from '@radix-ui/react-avatar';
import React from 'react';
import { cn } from './utils.js';

export function Avatar({ className, ...props }: React.ComponentProps<typeof AvatarPrimitive.Root>): React.JSX.Element {
  return <AvatarPrimitive.Root className={cn('relative flex size-8 shrink-0 overflow-hidden rounded-full', className)} {...props} />;
}
export function AvatarFallback({ className, ...props }: React.ComponentProps<typeof AvatarPrimitive.Fallback>): React.JSX.Element {
  return <AvatarPrimitive.Fallback className={cn('flex size-full items-center justify-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground', className)} {...props} />;
}
