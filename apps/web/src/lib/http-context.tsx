import React, { createContext, useContext } from 'react';
import type { Http } from '../workspace/data.js';
const Ctx = createContext<Http | undefined>(undefined);
export const HttpProvider = ({ http, children }: { http: Http; children: React.ReactNode }): React.JSX.Element => <Ctx.Provider value={http}>{children}</Ctx.Provider>;
export function useHttp(): Http { const h = useContext(Ctx); if (!h) throw new Error('HttpProvider is missing'); return h; }
