import { clsx, type ClassValue } from 'clsx';

/** Joins class names (shadcn's `cn`; the classes themselves are plain CSS in ui/shadcn.css). */
export const cn = (...inputs: ClassValue[]): string => clsx(inputs);
