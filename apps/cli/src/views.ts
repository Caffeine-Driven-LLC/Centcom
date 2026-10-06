/** The read-only `/mcp`, `/hooks` and `/memory` views inside the app: the same output as the terminal commands. Changing anything stays in the terminal commands, which show a diff and ask. */
import type { ControllerOptions } from '@centcom/tui';
import { makeHooksManager } from './commands/hooks/cli.js';
import { runHooks } from './commands/hooks/index.js';
import { makeMcpManager } from './commands/mcp/cli.js';
import { runMcp } from './commands/mcp/index.js';
import { makeMemoryFiles } from './commands/memory/cli.js';
import { runMemory } from './commands/memory/index.js';

const READ_ONLY = { mcp: ['list', 'status'], hooks: ['list', 'validate', 'templates'], memory: ['show', 'status'] } as const;
type Name = keyof typeof READ_ONLY;
async function capture(run: (io: { out(l: string): void; err(l: string): void; isTTY: boolean; confirm(q: string): Promise<boolean> }) => Promise<number>): Promise<string[]> {
  const lines: string[] = []; await run({ out: (l) => lines.push(...l.split('\n')), err: (l) => lines.push(...l.split('\n')), isTTY: false, confirm: async () => false }); return lines;
}
export function appViews(root: string): NonNullable<ControllerOptions['views']> {
  const guard = (name: Name, args: string[]): string[] | undefined => { const sub = args[0] ?? READ_ONLY[name][0]; return (READ_ONLY[name] as readonly string[]).includes(sub) ? [sub, ...args.slice(1)] : undefined; };
  const refuse = (name: Name) => [`In the app /${name} only shows (${READ_ONLY[name].join(', ')}).`, `To change something, run \`centcom ${name} ${name === 'mcp' ? 'add|remove' : name === 'hooks' ? 'add|remove' : 'add|edit|sync'}\` in a terminal: it shows the diff and asks first.`];
  return {
    mcp: async (args) => { const a = guard('mcp', args); if (!a) return refuse('mcp'); const mgr = makeMcpManager(); try { return await capture((io) => runMcp(a, { ...io, mgr, root })); } finally { mgr.dispose(); } },
    hooks: async (args) => { const a = guard('hooks', args); if (!a) return refuse('hooks'); return capture((io) => runHooks(a, { ...io, mgr: makeHooksManager(), root })); },
    memory: async (args) => { const a = guard('memory', args); if (!a) return refuse('memory'); return capture((io) => runMemory(a, { ...io, mf: makeMemoryFiles(root), root, edit: async (t) => t })); },
  };
}
