/** Splits assets/mascot/animations.json into one file per category plus a small index, so the page loads a category only when a mascot of that kind appears. `pnpm web:shell:build` runs it first. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

interface Anim { name: string; cat: string; w: number; h: number; frames: { d: number; rows: string[] }[]; [k: string]: unknown }
export function split(src: string, outDir: string): { index: Record<string, string>; categories: string[] } {
  const all = JSON.parse(readFileSync(src, 'utf8')) as { palette: Record<string, string>; palmap: Record<string, Record<string, string>>; animations: Anim[] }; mkdirSync(outDir, { recursive: true });
  const byCat = new Map<string, Anim[]>(); const index: Record<string, string> = {}; for (const a of all.animations) { byCat.set(a.cat, [...(byCat.get(a.cat) ?? []), a]); index[a.name] = a.cat; }
  for (const [cat, list] of byCat) writeFileSync(join(outDir, `${cat}.json`), JSON.stringify(Object.fromEntries(list.map((a) => [a.name, { w: a.w, h: a.h, frames: a.frames }]))));
  writeFileSync(join(outDir, 'index.json'), JSON.stringify({ index, palette: all.palette, palmap: all.palmap })); return { index, categories: [...byCat.keys()] };
}
if (process.argv[1]?.endsWith('split-animations.ts')) { const root = new URL('../../..', import.meta.url).pathname; const r = split(join(root, 'assets/mascot/animations.json'), join(root, 'apps/web/public/mascot')); console.log(`split ${Object.keys(r.index).length} animations into ${r.categories.length} categories`); }
