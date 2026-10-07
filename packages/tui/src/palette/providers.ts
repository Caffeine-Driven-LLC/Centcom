import { fuzzyScore } from './fuzzy.js';
import type { Group, PaletteItem, PaletteProvider } from './engine.js';

/** A provider over a list the app already has (commands, sessions, skills): fuzzy filter and rank, indices for highlighting. */
export function listProvider(id: string, group: Group, items: () => { id: string; label: string; detail?: string; run(): void | Promise<void> }[], opts: { recent?: () => string[]; max?: number } = {}): PaletteProvider {
  return {
    id, group,
    async search(q, signal) {
      const out: (PaletteItem & { s: number })[] = []; for (const it of items()) { if (signal.aborted) return []; const f = fuzzyScore(q, it.label); if (f) out.push({ ...it, indices: f.indices, s: f.score }); }
      return out.sort((a, b) => b.s - a.s).slice(0, opts.max ?? 8).map(({ s: _s, ...rest }) => { void _s; return rest; });
    },
    recent: opts.recent ? () => { const names = opts.recent!(); const all = items(); return names.flatMap((n) => all.filter((i) => i.label === n)); } : undefined,
  };
}
