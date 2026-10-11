import { cva, type VariantProps } from 'class-variance-authority';
import React from 'react';
import { cn } from './utils.js';

const badgeVariants = cva('sc-badge', {
  variants: { variant: { default: 'sc-badge--default', outline: 'sc-badge--outline', primary: 'sc-badge--primary', success: 'sc-badge--success', warning: 'sc-badge--warning', destructive: 'sc-badge--destructive' } },
  defaultVariants: { variant: 'default' },
});
export function Badge({ className, variant, ...props }: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants>): React.JSX.Element {
  return <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />;
}
