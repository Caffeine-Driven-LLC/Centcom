import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** shadcn's class helper: joins class names and lets a later Tailwind utility replace an earlier one. */
export const cn = (...inputs: ClassValue[]): string => twMerge(clsx(inputs));
