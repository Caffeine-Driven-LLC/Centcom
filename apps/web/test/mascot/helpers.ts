import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Catalog, type Index, type Sprite } from '../../src/mascot/catalog.js';

const root = join(process.cwd(), 'assets/mascot/animations.json');
interface A { name: string; cat: string; w: number; h: number; frames: { d: number; rows: string[] }[] }
export const all = JSON.parse(readFileSync(root, 'utf8')) as { palette: Record<string, string>; palmap: Record<string, Record<string, string>>; animations: A[] };
export const idx: Index = { index: Object.fromEntries(all.animations.map((a) => [a.name, a.cat])), palette: all.palette, palmap: all.palmap };
export const sprites = (cat: string): Record<string, Sprite> => Object.fromEntries(all.animations.filter((a) => a.cat === cat).map((a) => [a.name, { w: a.w, h: a.h, frames: a.frames }]));
export function fakeCatalog(): Catalog & { urls: string[] } { const urls: string[] = []; const c = new Catalog(async (u) => { urls.push(u); const path = u.replace('/mascot/', ''); return { ok: true, json: async () => (path === 'index.json' ? idx : sprites(path.replace('.json', ''))) }; }) as Catalog & { urls: string[] }; Object.defineProperty(c, 'urls', { get: () => urls }); return c; }
/** A canvas whose 2d context records what is drawn. */
export function stubCanvas(): { calls: { x: number; y: number; w: number; h: number; fill: string }[]; install(): void } { const calls: { x: number; y: number; w: number; h: number; fill: string }[] = []; let fill = ''; const ctx = { imageSmoothingEnabled: true, set fillStyle(v: string) { fill = v; }, get fillStyle() { return fill; }, clearRect: () => undefined, fillRect: (x: number, y: number, w: number, h: number) => void calls.push({ x, y, w, h, fill }) }; return { calls, install: () => { HTMLCanvasElement.prototype.getContext = (() => ctx) as never; } }; }
