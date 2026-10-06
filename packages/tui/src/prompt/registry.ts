/** Slash commands: other lanes register theirs; the prompt lists them as you type `/` and runs them. */
export type SlashResult = { ok: true; message?: string } | { ok: false; message: string };
export interface SlashContext { say(text: string): void }
export interface SlashCommand { name: string; aliases?: string[]; args?: string; description: string; hidden?: boolean; available?: () => boolean; run(args: string, ctx: SlashContext): Promise<SlashResult> }
export interface SlashCommandRegistry { register(c: SlashCommand): () => void; list(prefix?: string): SlashCommand[]; run(line: string, ctx?: SlashContext): Promise<SlashResult> }

/** Letters of the query in order (prefix first, then anywhere): what the suggestion list uses. */
function rank(q: string, name: string): number { const a = q.toLowerCase(); const n = name.toLowerCase(); if (n.startsWith(a)) return 100 - n.length; let i = 0; for (const ch of n) if (ch === a[i]) i++; return i === a.length ? 10 - n.length / 100 : -1; }
export function createSlashRegistry(): SlashCommandRegistry {
  const cmds = new Map<string, SlashCommand>();
  return {
    register(c) { if (cmds.has(c.name)) throw new Error(`/${c.name} is already registered`); cmds.set(c.name, c); return () => { if (cmds.get(c.name) === c) cmds.delete(c.name); }; },
    /** Visible, available commands matching what was typed after `/`, best first; at most 8 are shown by the prompt. */
    list(prefix = '') { const p = prefix.replace(/^\//, ''); const sc = (n: string) => (p ? rank(p, n) : 0); return [...cmds.values()].filter((c) => !c.hidden && (c.available?.() ?? true)).map((c) => ({ c, s: Math.max(sc(c.name), ...(c.aliases ?? []).map(sc)) })).filter((x) => !p || x.s >= 0).sort((a, b) => b.s - a.s || a.c.name.localeCompare(b.c.name)).map((x) => x.c); },
    async run(line, ctx = { say: () => undefined }) {
      const m = /^\/(\S+)\s*(.*)$/s.exec(line.trim()); if (!m) return { ok: false, message: 'Type / and a command name.' };
      const c = [...cmds.values()].find((x) => x.name === m[1] || x.aliases?.includes(m[1]!)); if (!c || !(c.available?.() ?? true)) return { ok: false, message: `Unknown command /${m[1]}. Type / to see the list.` };
      try { return await c.run(m[2]!.trim(), ctx); } catch (e) { return { ok: false, message: `/${c.name} failed: ${String((e as Error).message ?? e).slice(0, 120)}` }; }
    },
  };
}
/** `/clear` and `/exit` live here; everything else is registered by the lane that owns it. */
export function registerBuiltins(r: SlashCommandRegistry, h: { clear(): void; exit(): void }): () => void {
  const a = r.register({ name: 'clear', description: 'Clear the conversation on screen', run: async () => { h.clear(); return { ok: true }; } });
  const b = r.register({ name: 'exit', aliases: ['quit'], description: 'Leave Centcom', run: async () => { h.exit(); return { ok: true }; } });
  return () => { a(); b(); };
}
