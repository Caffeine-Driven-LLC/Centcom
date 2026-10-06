import React, { createContext, useContext, useEffect, useState } from 'react';
import { createTheme, type Theme, type Token, type TokenStyle } from './theme.js';

const Ctx = createContext<Theme>(createTheme({ caps: { tier: 'none', unicode: true }, mode: 'dark' }));
export function ThemeProvider({ theme, children }: { theme: Theme; children: React.ReactNode }) { return <Ctx.Provider value={theme}>{children}</Ctx.Provider>; }
/** The theme; the component re-renders when the mode changes. */
export function useTheme(): Theme { const t = useContext(Ctx); const [, bump] = useState(0); useEffect(() => t.subscribe(() => bump((n) => n + 1)), [t]); return t; }
export const useToken = (token: Token): TokenStyle => useTheme().style(token);
