import { PAL_HEX } from '@centcom/mascot-browser';
export interface Frame { d: number; rows: string[] } export interface Sprite { w: number; h: number; frames: Frame[] }
export interface Index { index: Record<string, string>; palette: Record<string, string>; palmap: Record<string, Record<string, string>> }
export type Fetcher = (url: string) => Promise<{ ok: boolean; json(): Promise<unknown> }>;
/** Animations by name, loaded one category at a time, the first time a mascot of that category is shown. Each category is fetched once. */
export class Catalog {
  private idx?: Promise<Index>; private cats = new Map<string, Promise<Record<string, Sprite>>>(); fetched: string[] = [];
  constructor(private readonly fetchJson: Fetcher, private readonly base = '/mascot') {}
  private get(path: string): Promise<unknown> { this.fetched.push(path); return this.fetchJson(`${this.base}/${path}`).then((r) => { if (!r.ok) throw new Error('mascot data missing'); return r.json(); }); }
  index(): Promise<Index> { return (this.idx ??= this.get('index.json') as Promise<Index>); }
  async sprite(name: string): Promise<Sprite | undefined> { const ix = await this.index(); const cat = ix.index[name]; if (!cat) return undefined; let p = this.cats.get(cat); if (!p) { p = this.get(`${cat}.json`) as Promise<Record<string, Sprite>>; p.catch(() => this.cats.delete(cat)); this.cats.set(cat, p); } return (await p)[name]; }
}
/** The palette letters of one body colour: the five colours swap B, D, H and S for other letters (the palmap). */
export function paletteFor(ix: Pick<Index, 'palette' | 'palmap'>, colour: string): Record<string, string> { const m = ix.palmap[colour] ?? ix.palmap.violet ?? {}; const out: Record<string, string> = { ...PAL_HEX, ...ix.palette }; for (const [from, to] of Object.entries(m)) if (out[to]) out[from] = out[to]!; return out; }
