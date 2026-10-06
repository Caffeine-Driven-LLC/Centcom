import React, { createContext, useContext } from 'react';

export type Motion = 'full' | 'reduced';
const Ctx = createContext<Motion>('full');
export function MotionProvider({ value = 'full', children }: { value?: Motion; children: React.ReactNode }) { return <Ctx.Provider value={value}>{children}</Ctx.Provider>; }
/** `reduced` means: static glyphs, no animation, no mascot effects. Components read this instead of looking at the environment. */
export const useMotion = (): Motion => useContext(Ctx);
/** Crash, glitch and panic animations are never chosen when motion is reduced. */
export const REDUCED_FORBIDDEN = new Set(['crash', 'glitch', 'panic']);
export const allowedAnimation = (name: string, m: Motion): boolean => !(m === 'reduced' && REDUCED_FORBIDDEN.has(name));
