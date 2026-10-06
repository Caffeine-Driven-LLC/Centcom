/** `centcom memory show|edit|add|status|sync`. Everything it touches is injected. Nothing is written without the diff shown and a yes. */
import { MemoryError, redactProviderText, type MemEngine, type MemoryFiles, type MemoryPlan } from '@centcom/agent';

export interface MemoryIO { mf: MemoryFiles; root: string; out(line: string): void; err(line: string): void; isTTY: boolean; confirm(q: string): Promise<boolean>; /** Opens the text in the person's editor and returns what they saved (undefined if they quit). */ edit?(initial: string): Promise<string | undefined> }
export const MEMORY_HELP = `centcom memory show [claude|codex] [--scope project|user]
centcom memory add "text" [--to claude|codex|both] [--scope project|user] [--yes]
centcom memory edit [claude|codex] [--scope project|user]
centcom memory status
centcom memory sync [push | pull --from claude|codex] [--yes]`;
const ENG: Record<string, MemEngine> = { claude: 'claude-code', 'claude-code': 'claude-code', codex: 'codex' };
const opt = (a: string[], n: string) => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : undefined; };

async function review(plan: MemoryPlan, io: MemoryIO, yes: boolean): Promise<number> {
  if (!plan.targets.length) { io.out('Nothing to change.'); return 0; } io.out(plan.diff);
  if (!yes) { if (!io.isTTY) { io.err('This needs an interactive terminal to confirm, or pass --yes.'); return 1; } if (!(await io.confirm('Write this change?'))) { io.out('Nothing changed.'); return 1; } }
  try { const r = await io.mf.apply(plan, { accepted: true, planHash: plan.planHash }); io.out(`Wrote ${r.written.length} file${r.written.length === 1 ? '' : 's'}.`); return 0; }
  catch (e) { return fail(e, io); }
}
function fail(e: unknown, io: MemoryIO): number {
  if (e instanceof MemoryError) { io.err(e.message); return e.code === 'unsafe_path' || e.code === 'no_path' ? 2 : 1; } io.err('Something went wrong: ' + redactProviderText(String((e as Error)?.message ?? e)).slice(0, 200)); return 1;
}

export async function runMemory(argv: string[], io: MemoryIO): Promise<number> {
  const [sub, ...rest] = argv; const flags = new Set(rest.filter((a) => a.startsWith('--'))); const scope = (opt(rest, '--scope') ?? 'project') as 'project' | 'user'; if (scope !== 'project' && scope !== 'user') { io.err('--scope is project or user.'); return 2; }
  const positional = rest.filter((a, i) => !a.startsWith('--') && !(rest[i - 1] ?? '').startsWith('--') || (!a.startsWith('--') && ['--yes'].includes(rest[i - 1] ?? '')));
  const root = scope === 'project' ? io.root : undefined;
  try {
    switch (sub) {
      case 'show': { const eng = ENG[positional[0] ?? 'claude']; if (!eng) { io.err('Use claude or codex.'); return 2; } const r = await io.mf.read(eng, scope, root); if (!r.exists) { io.out('(no file yet)'); return 0; } if (r.unreadable) { io.err('That file is not text.'); return 1; } io.out(r.text); return 0; }
      case 'add': {
        const text = positional[0]; if (!text) { io.err('Usage: centcom memory add "text"'); return 2; } const to = opt(rest, '--to') ?? 'both'; const engine = to === 'both' ? 'both' : ENG[to]; if (!engine) { io.err('--to is claude, codex or both.'); return 2; }
        return review(await io.mf.plan({ engine, scope, quickAdd: text, root }), io, flags.has('--yes'));
      }
      case 'edit': {
        const eng = ENG[positional[0] ?? 'claude']; if (!eng) { io.err('Use claude or codex.'); return 2; } if (!io.edit) { io.err('No editor is available here.'); return 1; } const cur = await io.mf.read(eng, scope, root); if (cur.unreadable) { io.err('That file is not text.'); return 1; }
        const next = await io.edit(cur.text); if (next === undefined || next === cur.text) { io.out('Nothing changed.'); return 0; } return review(await io.mf.plan({ engine: eng, scope, newText: next, root }), io, flags.has('--yes'));
      }
      case 'status': { const s = await io.mf.status(io.root); if (s.state === 'disabled') { io.out('Memory sync is off for this project (set memory.sync in .centcom/config.json).'); return 0; } io.out(`sync: ${s.state}`); for (const f of s.files) io.out(`  ${f.engine}  ${f.state}`); const hint = await io.mf.importHint(io.root); if (hint) io.out(`${hint.missing === 'codex' ? 'AGENTS.md' : 'CLAUDE.md'} is missing. Create it as a pointer or a copy of the other with: centcom memory add`); return s.state === 'in_sync' ? 0 : 1; }
      case 'sync': {
        const dir = positional[0] === 'pull' ? 'target_to_source' : 'source_to_targets'; const from = ENG[opt(rest, '--from') ?? ''];
        return review(await io.mf.sync({ direction: dir, ...(from ? { from } : {}), root: io.root }), io, flags.has('--yes'));
      }
      default: io.err(MEMORY_HELP); return sub ? 2 : 0;
    }
  } catch (e) { return fail(e, io); }
}
