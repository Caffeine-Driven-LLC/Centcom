export const used = (n: number): number => (n > 0 ? n : -n);
export const unused1 = (n: number): number => { if (n > 10) return 1; if (n > 5) return 2; return 3; };
export const unused2 = (s: string): string => s.toUpperCase() + s.toLowerCase();
export const unused3 = (s: string): string => s.trim();
