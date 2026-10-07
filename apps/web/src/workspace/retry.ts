import { useEffect, useRef, useState } from 'react';
/** 429: the seconds the server asked for, counted down once a second; while it runs the button stays off with the number in its reason. */
export function useRetryAfter(): { seconds: number; arm(s: number): void; reason: string | undefined } {
  const [seconds, setSeconds] = useState(0); const h = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  useEffect(() => () => { if (h.current) clearInterval(h.current); }, []);
  const arm = (s: number): void => { if (h.current) clearInterval(h.current); setSeconds(Math.max(1, Math.ceil(s))); h.current = setInterval(() => setSeconds((n) => { if (n <= 1) { if (h.current) clearInterval(h.current); h.current = undefined; return 0; } return n - 1; }), 1000); };
  return { seconds, arm, reason: seconds > 0 ? `Too many requests. Try again in ${seconds}s.` : undefined };
}
