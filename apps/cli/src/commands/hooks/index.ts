/** `centcom hooks list|add|remove|validate`. Hooks are run by the engines, never by Centcom. A change is only written after the full diff is shown and confirmed. */
import { HooksError, redactProviderText, type HookDef, type HookScope, type HooksManager, type HooksPlan } from '@centcom/agent';

export interface HooksIO { mgr: HooksManager; root: string; out(line: string): void; err(line: string): void; isTTY: boolean; confirm(q: string): Promise<boolean> }
export const HOOKS_HELP = `centcom hooks list [--scope project|local|user]
centcom hooks add --template <id> [--choice name=value]... [--scope project|local|user] [--yes]
centcom hooks add --event <Event> --cmd <command> [--matcher <text>] [--timeout <seconds>] [--scope ...] [--yes]
centcom hooks remove --event <Event> --index <n> [--scope ...] [--yes]
centcom hooks validate [--scope ...]
centcom hooks templates`;
const all = (a: string[], n: string) => a.flatMap((x, i) => (x === n && a[i + 1] !== undefined ? [a[i + 1]!] : []));
const one = (a: string[], n: string) => all(a, n)[0];
const fail = (e: unknown, io: HooksIO): number => { if (e instanceof HooksError) { io.err(e.message + (e.detail ? ` (${e.detail})` : '')); return e.code === 'invalid_hook' || e.code === 'too_many' || e.code === 'capability_missing' ? 2 : 1; } io.err('Something went wrong: ' + redactProviderText(String((e as Error)?.message ?? e)).slice(0, 200)); return 1; };

async function review(plan: HooksPlan, io: HooksIO, yes: boolean): Promise<number> {
  io.out(plan.diff); for (const w of plan.warnings) io.out(`! ${w}`); for (const i of plan.issues) io.out(`! ${i.message}`);
  if (!yes) { if (!io.isTTY) { io.err('This needs an interactive terminal to confirm, or pass --yes.'); return 1; } if (!(await io.confirm('Write this change?'))) { io.out('Nothing changed.'); return 1; } if (plan.scope === 'user' && !(await io.confirm('This changes your user-level settings for every project. Continue?'))) { io.out('Nothing changed.'); return 1; } }
  const r = await io.mgr.apply(plan, { accepted: true, planHash: plan.planHash, ...(plan.scope === 'user' ? { userScope: true as const } : {}) }); io.out(`Wrote ${r.path}${r.backup ? ` (backup: ${r.backup})` : ''}.`); return 0;
}
export async function runHooks(argv: string[], io: HooksIO): Promise<number> {
  const [sub, ...rest] = argv; const scope = (one(rest, '--scope') ?? 'project') as HookScope; if (!['project', 'local', 'user'].includes(scope)) { io.err('--scope is project, local or user.'); return 2; }
  const yes = rest.includes('--yes'); const root = io.root;
  try {
    switch (sub) {
      case 'templates': for (const t of io.mgr.templates()) io.out(`${t.id}  ${t.event}${t.matcher ? ` (${t.matcher})` : ''}  ${t.title}`); return 0;
      case 'list': case 'validate': {
        const l = await io.mgr.list(root); let bad = 0;
        if (!l.claude.supported) io.out(`Claude Code: ${l.claude.reason}`); else { io.out('Claude Code' + (l.claude.banner ? '  (could not verify against your installed version)' : '')); for (const e of l.claude.entries.filter((x) => x.scope === scope || rest.indexOf('--scope') < 0)) { io.out(`  [${e.scope}] ${e.event}#${e.index}${e.def.matcher ? ` (${e.def.matcher})` : ''}  ${e.def.command}${e.def.timeout_s ? `  (${e.def.timeout_s}s)` : ''}`); for (const i of e.issues) { io.out(`      ! ${i.code}: ${i.message}`); bad++; } if (e.review) io.out(`      ! review before running (${e.review === 'never_confirmed' ? 'not confirmed here yet' : 'changed since you last confirmed it'})`); } }
        if (!l.codex.supported) io.out(`Codex: ${l.codex.reason}`); return sub === 'validate' && bad ? 1 : 0;
      }
      case 'add': {
        const tpl = one(rest, '--template'); let event: string; let def: HookDef;
        if (tpl) { const choices = Object.fromEntries(all(rest, '--choice').map((c) => { const i = c.indexOf('='); return [c.slice(0, i), c.slice(i + 1)]; })); ({ event, def } = io.mgr.fromTemplate(tpl, choices)); }
        else { const ev = one(rest, '--event'); const cmd = one(rest, '--cmd'); if (!ev || !cmd) { io.err('Usage: centcom hooks add --template <id>, or --event <Event> --cmd <command>'); return 2; } event = ev; const t = one(rest, '--timeout'); const m = one(rest, '--matcher'); def = { command: cmd, ...(m !== undefined ? { matcher: m } : {}), ...(t !== undefined ? { timeout_s: Number(t) } : {}) }; }
        return review(await io.mgr.plan({ kind: 'add', engine: 'claude-code', scope, event, def, root }), io, yes);
      }
      case 'remove': { const event = one(rest, '--event'); const index = Number(one(rest, '--index')); if (!event || !Number.isInteger(index)) { io.err('Usage: centcom hooks remove --event <Event> --index <n>'); return 2; } return review(await io.mgr.plan({ kind: 'remove', engine: 'claude-code', scope, event, index, root }), io, yes); }
      default: io.err(HOOKS_HELP); return sub ? 2 : 0;
    }
  } catch (e) { return fail(e, io); }
}
