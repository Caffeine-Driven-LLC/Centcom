/** `centcom crash list | show <id> | delete <id|--all>`: look at, and remove, the reports kept on this computer. */
import type { CrashStore } from './report.js';

export interface CrashIo { out(l: string): void; err(l: string): void }
export function runCrash(argv: string[], store: CrashStore, io: CrashIo): number {
  const [sub, arg] = argv;
  if (sub === 'list') { const l = store.list(); if (!l.length) io.out('No crash reports on this computer.'); for (const r of l) io.out(`${r.id}  ${r.at}  ${r.code ?? r.name}  ${r.message.slice(0, 60)}`); return 0; }
  if (sub === 'show') { if (!arg) { io.err('Usage: centcom crash show <id>'); return 2; } const r = store.read(arg); if (!r) { io.err(`No crash report ${arg.slice(0, 40)}.`); return 1; } io.out(JSON.stringify(r, null, 2)); return 0; }
  if (sub === 'delete') {
    if (arg === '--all') { const n = store.deleteAll(); io.out(`Deleted ${n} report${n === 1 ? '' : 's'}.`); return 0; }
    if (!arg) { io.err('Usage: centcom crash delete <id|--all>'); return 2; } if (!store.delete(arg)) { io.err(`No crash report ${arg.slice(0, 40)}.`); return 1; } io.out('Deleted.'); return 0;
  }
  io.err('Usage: centcom crash list | show <id> | delete <id|--all>'); return 2;
}
