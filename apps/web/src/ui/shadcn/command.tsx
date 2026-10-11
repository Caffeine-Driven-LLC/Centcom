import { Command as CommandPrimitive } from 'cmdk';
import { Search } from 'lucide-react';
import React from 'react';
import { cn } from './utils.js';

export function Command({ className, ...props }: React.ComponentProps<typeof CommandPrimitive>): React.JSX.Element {
  return <CommandPrimitive className={cn('flex w-full flex-col overflow-hidden bg-popover text-popover-foreground', className)} {...props} />;
}
export function CommandInput({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Input>): React.JSX.Element {
  return (
    <div className="flex items-center gap-2 border-b border-border px-4">
      <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <CommandPrimitive.Input className={cn('h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground', className)} {...props} />
    </div>
  );
}
export function CommandList({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.List>): React.JSX.Element {
  return <CommandPrimitive.List className={cn('max-h-[360px] overflow-x-hidden overflow-y-auto p-2', className)} {...props} />;
}
export const CommandEmpty = (props: React.ComponentProps<typeof CommandPrimitive.Empty>): React.JSX.Element => <CommandPrimitive.Empty className="py-8 text-center text-sm text-muted-foreground" {...props} />;
export function CommandGroup({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Group>): React.JSX.Element {
  return <CommandPrimitive.Group className={cn('overflow-hidden [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground', className)} {...props} />;
}
export function CommandItem({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Item>): React.JSX.Element {
  return <CommandPrimitive.Item className={cn('flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm outline-none select-none data-[selected=true]:bg-accent data-[disabled=true]:opacity-50 [&_svg]:size-4 [&_svg]:text-muted-foreground', className)} {...props} />;
}
