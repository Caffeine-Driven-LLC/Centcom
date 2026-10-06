/** The full baked animation library (319 animations, assets/mascot): loaded lazily, recolourable. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PALMAP, type CentoColor } from './palette.js';

export interface BakedAnimation { name: string; cat: string; desc: string; w: number; h: number; social: boolean; frames: { d: number; rows: string[] }[] }
interface LibraryFile { animations: BakedAnimation[] }

let cache: Map<string, BakedAnimation> | undefined;
function load(): Map<string, BakedAnimation> {
  if (!cache) {
    const file = fileURLToPath(new URL('../data/animations.json', import.meta.url));
    const data = JSON.parse(readFileSync(file, 'utf8')) as LibraryFile;
    cache = new Map(data.animations.map((a) => [a.name, a]));
  }
  return cache;
}

export function bakedNames(): string[] { return [...load().keys()]; }
export function bakedCategories(): string[] { return [...new Set([...load().values()].map((a) => a.cat))]; }
export function bakedByCategory(cat: string): BakedAnimation[] { return [...load().values()].filter((a) => a.cat === cat); }
export function getBaked(name: string): BakedAnimation | undefined { return load().get(name); }

/** Recolour a baked animation's body (violet) and, for two-character scenes, the friend (green) to the given colours. */
export function recolorBaked(a: BakedAnimation, me: CentoColor, friend: CentoColor = 'green'): BakedAnimation {
  if (me === 'violet' && friend === 'green') return a;
  const m = PALMAP[me], f = PALMAP[friend];
  const map: Record<string, string> = { B: m.B, D: m.D, H: m.H, S: m.S, '1': f.B, '2': f.D, '3': f.H };
  return { ...a, frames: a.frames.map((fr) => ({ d: fr.d, rows: fr.rows.map((r) => r.replace(/[BDHS123]/g, (ch) => map[ch] ?? ch)) })) };
}
