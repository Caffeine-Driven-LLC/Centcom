/** Runs the providers for a query: 30 ms debounce, the previous query aborted, and a provider that is slow never holds back the others. */
export type Group = 'Commands' | 'Files' | 'Sessions' | 'Skills';
export const GROUPS: readonly Group[] = ['Commands', 'Files', 'Sessions', 'Skills'];
export interface PaletteItem { id: string; label: string; detail?: string; run(): void | Promise<void>; /** Character positions of the match in `label`, filled in by the engine. */ indices?: number[] }
export interface PaletteProvider { id: string; group: Group; search(q: string, signal: AbortSignal): Promise<PaletteItem[]>; recent?(): PaletteItem[] }
export interface PaletteClock { setTimeout(f: () => void, ms: number): unknown; clearTimeout(h: unknown): void }
export interface Section { group: Group; items: PaletteItem[]; recent?: boolean }
export interface PaletteEngine { setQuery(q: string): void; subscribe(fn: (s: Section[]) => void): () => void; sections(): Section[]; close(): void }

const realClock: PaletteClock = { setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (h) => clearTimeout(h as NodeJS.Timeout) };
export function createPaletteEngine(d: { providers: PaletteProvider[]; clock?: PaletteClock; debounceMs?: number; softMs?: number; recentMax?: number }): PaletteEngine {
  const clock = d.clock ?? realClock; const debounce = d.debounceMs ?? 30; const soft = d.softMs ?? 100;
  let timer: unknown; let ctl: AbortController | undefined; let results = new Map<string, PaletteItem[]>(); let recent = true; const subs = new Set<(s: Section[]) => void>();
  const build = (): Section[] => GROUPS.flatMap((g) => { const items = d.providers.filter((p) => p.group === g).flatMap((p) => results.get(p.id) ?? []); return items.length ? [{ group: g, items, ...(recent ? { recent: true } : {}) }] : []; });
  const emit = () => { const s = build(); for (const f of subs) f(s); };
  function showRecent() { results = new Map(); for (const p of d.providers) { const r = p.recent?.(); if (r?.length) results.set(p.id, r.slice(0, d.recentMax ?? 5)); } recent = true; emit(); }
  async function run(q: string) {
    ctl?.abort(); const my = new AbortController(); ctl = my; results = new Map(); recent = false; let late = false; const t = clock.setTimeout(() => { late = true; }, soft);
    await Promise.all(d.providers.map(async (p) => {
      try { const items = await p.search(q, my.signal); if (my.signal.aborted) return; results.set(p.id, items); emit(); /* a slow provider's results append when they arrive (the caller keeps the selection by item id) */ }
      catch { /* a failing provider shows nothing */ }
    }));
    clock.clearTimeout(t); void late;
  }
  return {
    setQuery(q) { if (timer !== undefined) clock.clearTimeout(timer); if (!q) { ctl?.abort(); showRecent(); return; } ctl?.abort(); timer = clock.setTimeout(() => { timer = undefined; void run(q); }, debounce); },
    subscribe(fn) { subs.add(fn); fn(build()); return () => { subs.delete(fn); }; }, sections: build,
    close() { if (timer !== undefined) clock.clearTimeout(timer); ctl?.abort(); subs.clear(); },
  };
}
