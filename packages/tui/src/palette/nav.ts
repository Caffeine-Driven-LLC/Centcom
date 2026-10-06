/** Keyboard handling of the palette as pure functions: move with wrap, run, close. */
import type { PaletteItem, Section } from './engine.js';

export interface PaletteState { query: string; sel: number }
export const flatten = (s: Section[]): PaletteItem[] => s.flatMap((x) => x.items);
export type PaletteKey = 'up' | 'down' | 'enter' | 'escape';
/** Moves wrap around. `selectedId` keeps the same item selected when late results arrive. */
export function move(state: PaletteState, sections: Section[], key: 'up' | 'down'): PaletteState {
  const n = flatten(sections).length; if (!n) return { ...state, sel: 0 }; return { ...state, sel: key === 'down' ? (state.sel + 1) % n : (state.sel + n - 1) % n };
}
export function keepSelection(state: PaletteState, before: Section[], after: Section[]): PaletteState {
  const id = flatten(before)[state.sel]?.id; if (!id) return { ...state, sel: 0 }; const i = flatten(after).findIndex((x) => x.id === id); return { ...state, sel: i >= 0 ? i : 0 };
}
export const selected = (state: PaletteState, sections: Section[]): PaletteItem | undefined => flatten(sections)[state.sel];
