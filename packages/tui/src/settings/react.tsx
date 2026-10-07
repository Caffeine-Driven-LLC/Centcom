import React, { createContext, useContext, useEffect, useState } from 'react';
import { DEFAULTS, type SettingsStore, type UiSettings } from './store.js';

const Ctx = createContext<SettingsStore | undefined>(undefined);
export function SettingsProvider({ store, children }: { store: SettingsStore; children: React.ReactNode }) { return <Ctx.Provider value={store}>{children}</Ctx.Provider>; }
/** The settings in effect; re-renders on every change. */
export function useSettings(): UiSettings { const s = useContext(Ctx); const [v, set] = useState<UiSettings>(s?.get() ?? DEFAULTS); useEffect(() => (s ? s.subscribe(set) : undefined), [s]); return v; }
export const useDensity = (): UiSettings['density'] => useSettings().density;
/** Blank rows between transcript blocks: one when comfortable, none when compact. */
export const blockGap = (d: UiSettings['density']): number => (d === 'compact' ? 0 : 1);
