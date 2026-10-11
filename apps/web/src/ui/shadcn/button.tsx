import { cva, type VariantProps } from 'class-variance-authority';
import React from 'react';
import { cn } from './utils.js';

export const buttonVariants = cva('sc-btn', {
  variants: {
    variant: { default: 'sc-btn--default', destructive: 'sc-btn--destructive', outline: 'sc-btn--outline', secondary: 'sc-btn--secondary', ghost: 'sc-btn--ghost', link: 'sc-btn--link' },
    size: { default: 'sc-btn--md', sm: 'sc-btn--sm', lg: 'sc-btn--lg', icon: 'sc-btn--icon' },
  },
  defaultVariants: { variant: 'default', size: 'default' },
});

export interface ButtonProps extends React.ComponentProps<'button'>, VariantProps<typeof buttonVariants> {}
export function Button({ className, variant, size, type = 'button', ...props }: ButtonProps): React.JSX.Element {
  return <button data-slot="button" type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
