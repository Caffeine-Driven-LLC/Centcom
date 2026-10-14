import React, { createContext, useContext, useEffect, useState } from 'react';
import { createTheme, type Theme, type Token, type TokenStyle } from './theme.js';

const fallback = createTheme({ caps: { tier: 'none', unicode: true }, mode: 'dark' }); const Ctx = createContext<Theme | undefined>(undefined);
export function ThemeProvider({ theme, children }: { theme: Theme; children: React.ReactNode }) { return <Ctx.Provider value={theme}>{children}</Ctx.Provider>; }
/** The theme; the component re-renders when the mode changes. */
export function useTheme(): Theme { const t = useContext(Ctx) ?? fallback; const [, bump] = useState(0); useEffect(() => t.subscribe(() => bump((n) => n + 1)), [t]); return t; }
export const useToken = (token: Token): TokenStyle => useTheme().style(token);
/** The theme a provider gave, or undefined when there is none (components used on their own). */
export const useProvidedTheme = (): Theme | undefined => useContext(Ctx);
