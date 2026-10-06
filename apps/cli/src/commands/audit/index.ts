/** `centcom audit list|export`. Exit codes: 0 ok, 1 failure, 2 sign-in needed, 4 no matching events (list only). */
import { createWriteStream } from 'node:fs';
import { access, rm } from 'node:fs/promises';
import type { AuditDeps, AuditFs, Writer } from './common.js';
import { usage } from './common.js';
import { runExport } from './export.js';
import { runList } from './list.js';

export type { AuditDeps, AuditFs, AuditIo, Writer } from './common.js';
export { parseTimeFilter } from './time-filter.js';
export const HELP = ['Usage: centcom audit <command>', '  list [--workspace wsp_..] [--actor <id>] [--action <name>] [--from <time>] [--to <time>] [--limit n] [--json]', '  export --format csv|json [--from] [--to] [--actor] [--action] [--out <file>] [--wait] [--force]', 'Times: 2026-10-01T00:00:00Z, or 90m, 24h, 7d, 2w (ago).'];
export async function runAudit(argv: string[], d: AuditDeps): Promise<number> {
  const [sub, ...rest] = argv; if (sub === 'list') return runList(rest, d); if (sub === 'export') return runExport(rest, d);
  for (const l of HELP) d.io.err(l); return sub === 'help' || sub === '--help' ? 0 : usage(d, '');
}
export function registerAuditCommands(program: { command(name: string, run: (argv: string[]) => Promise<number>): void }, deps: AuditDeps): void { program.command('audit', (argv) => runAudit(argv, deps)); }
/** The real file system: files are created with mode 0600 and never overwritten silently (the command checks first). */
export const nodeAuditFs: AuditFs = {
  exists: (p) => access(p).then(() => true, () => false),
  async createWriter(path, mode): Promise<Writer> {
    const s = createWriteStream(path, { mode, flags: 'w' }); await new Promise<void>((res, rej) => { s.once('open', () => res()); s.once('error', rej); });
    const end = () => new Promise<void>((res) => s.end(() => res()));
    return { write: (c) => new Promise<void>((res, rej) => s.write(c, (e) => (e ? rej(e) : res()))), close: end, abort: async () => { s.destroy(); await rm(path, { force: true }); } };
  },
};
