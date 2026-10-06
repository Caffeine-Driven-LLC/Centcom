/** `centcom mcp list|add|remove|status|test`. Everything it touches is injected. Config is only written after the diff is shown and confirmed. */
import { McpError, redactProviderText, type McpEngine, type McpManager, type McpPlan, type McpServerDef } from '@centcom/agent';

export interface McpIO { mgr: McpManager; root: string; out(line: string): void; err(line: string): void; isTTY: boolean; confirm(q: string): Promise<boolean> }
export const MCP_HELP = `centcom mcp list [--scope project|user]
centcom mcp add <name> (--cmd <program> [--arg <a>]... | --url <https-url> [--transport http|sse]) [--env-ref NAME=VARIABLE]... [--header-ref Header=VARIABLE]... [--engine claude|codex|both] [--scope project|user] [--yes]
centcom mcp remove <name> [--engine claude|codex|both] [--scope project|user] [--yes]
centcom mcp status
centcom mcp test <name> [--engine claude|codex]`;
const ENG: Record<string, McpEngine> = { claude: 'claude-code', 'claude-code': 'claude-code', codex: 'codex' };
const all = (a: string[], n: string) => a.flatMap((x, i) => (x === n && a[i + 1] !== undefined ? [a[i + 1]!] : []));
const one = (a: string[], n: string) => all(a, n)[0];
const pairs = (list: string[]): Record<string, string> | undefined => { if (!list.length) return undefined; return Object.fromEntries(list.map((p) => { const i = p.indexOf('='); return i > 0 ? [p.slice(0, i), p.slice(i + 1)] : [p, '']; })); };
const FLAGS_WITH_VALUE = new Set(['--cmd', '--arg', '--url', '--transport', '--env-ref', '--header-ref', '--engine', '--scope']);
const positionals = (a: string[]) => a.filter((x, i) => !x.startsWith('--') && !FLAGS_WITH_VALUE.has(a[i - 1] ?? ''));
const fail = (e: unknown, io: McpIO): number => { if (e instanceof McpError) { io.err(e.message + (e.detail ? ` (${e.detail})` : '')); return e.code === 'invalid_server' || e.code === 'unsupported' ? 2 : 1; } io.err('Something went wrong: ' + redactProviderText(String((e as Error)?.message ?? e)).slice(0, 200)); return 1; };

async function review(plan: McpPlan, io: McpIO, yes: boolean): Promise<number> {
  io.out(plan.diff); for (const w of plan.warnings) io.out(`! ${w}`);
  if (!yes) { if (!io.isTTY) { io.err('This needs an interactive terminal to confirm, or pass --yes.'); return 1; } if (!(await io.confirm('Write this change?'))) { io.out('Nothing changed.'); return 1; } if (plan.scope === 'user' && !(await io.confirm('This changes your user-level settings for every project. Really?'))) { io.out('Nothing changed.'); return 1; } }
  try { const r = await io.mgr.apply(plan, { accepted: true, planHash: plan.planHash, ...(plan.scope === 'user' ? { userScope: true as const } : {}) }); io.out(`Wrote ${r.written.length} file${r.written.length === 1 ? '' : 's'}${r.written.some((w) => w.backup) ? ' (the old version is kept next to it as .centcom-bak)' : ''}.`); return 0; } catch (e) { return fail(e, io); }
}
export async function runMcp(argv: string[], io: McpIO): Promise<number> {
  const [sub, ...rest] = argv; const scope = (one(rest, '--scope') ?? 'project') as 'project' | 'user'; if (scope !== 'project' && scope !== 'user') { io.err('--scope is project or user.'); return 2; }
  const engOpt = one(rest, '--engine') ?? 'both'; const engine = engOpt === 'both' ? ('both' as const) : ENG[engOpt]; if (!engine) { io.err('--engine is claude, codex or both.'); return 2; }
  const root = io.root; const pos = positionals(rest); const yes = rest.includes('--yes');
  try {
    switch (sub) {
      case 'list': for (const e of await io.mgr.list(scope, root)) { io.out(e.engine); if (e.unsupported) io.out(`  (${e.unsupported})`); for (const b of e.builtin) io.out(`  ${b.name}  built in (locked)`); for (const s of e.servers) io.out(`  ${s.name}  ${s.transport}  ${s.transport === 'stdio' ? s.command : s.url}`); } return 0;
      case 'add': {
        const name = pos[0]; if (!name) { io.err('Usage: centcom mcp add <name> --cmd <program> | --url <url>'); return 2; } const cmd = one(rest, '--cmd'); const url = one(rest, '--url'); if ((cmd === undefined) === (url === undefined)) { io.err('Give either --cmd or --url.'); return 2; }
        const t = one(rest, '--transport'); const def: McpServerDef = { name, transport: cmd !== undefined ? 'stdio' : t === 'sse' ? 'sse' : 'http', ...(cmd !== undefined ? { command: cmd } : { url }), ...(all(rest, '--arg').length ? { args: all(rest, '--arg') } : {}), ...(pairs(all(rest, '--env-ref')) ? { env_refs: pairs(all(rest, '--env-ref')) } : {}), ...(pairs(all(rest, '--header-ref')) ? { header_refs: pairs(all(rest, '--header-ref')) } : {}) };
        return review(await io.mgr.plan({ kind: 'add', engine, scope, def, root }), io, yes);
      }
      case 'remove': { const name = pos[0]; if (!name) { io.err('Usage: centcom mcp remove <name>'); return 2; } return review(await io.mgr.plan({ kind: 'remove', engine, scope, name, root }), io, yes); }
      case 'status': for (const s of io.mgr.status()) { io.out(s.engine + (s.reported ? '' : '  (status not reported by this version, or no session is running)')); for (const x of s.servers) io.out(`  ${x.name}  ${x.state}${x.tools !== undefined ? `  ${x.tools} tools` : ''}${x.error ? `  ${x.error}` : ''}${x.builtin ? '  (built in)' : ''}`); } return 0;
      case 'test': {
        const name = pos[0]; if (!name) { io.err('Usage: centcom mcp test <name>'); return 2; } const eng = engine === 'both' ? ('claude-code' as const) : engine; let def: McpServerDef | undefined; for (const e of await io.mgr.list(scope, root)) def ??= e.servers.find((s) => s.name === name); if (!def) { io.err('There is no server with that name.'); return 1; }
        const r = await io.mgr.testServer(def, eng); io.out(`${name}  ${r.state}${r.tools !== undefined ? `  ${r.tools} tools` : ''}${r.error ? `  ${r.error}` : ''}`); return r.state === 'connected' ? 0 : 1;
      }
      default: io.err(MCP_HELP); return sub ? 2 : 0;
    }
  } catch (e) { return fail(e, io); }
}
