/** `centcom --continue` / `-c` and `centcom --resume [id]` (lane C026): which saved conversation to open, decided before the screen starts. */
import { createInterface } from 'node:readline';
import { ago, type SessionMeta, type SessionStore } from '@centcom/tui';

export type ResumeChoice = { id: string } | { exit: number; message: string } | { pick: SessionMeta[] };

/** `id` is the value after --resume: undefined (or a flag) means "show the list". */
export function chooseSession(store: Pick<SessionStore, 'list' | 'load'>, o: { cwd: string; continue?: boolean; resume?: boolean; id?: string }): ResumeChoice {
  if (o.continue) { const last = store.list(o.cwd, 1)[0]; return last ? { id: last.id } : { exit: 1, message: 'No session to continue in this directory.' }; }
  if (!o.resume) return { exit: 0, message: '' };
  if (o.id && !o.id.startsWith('-')) { try { return store.load(o.id) ? { id: o.id } : { exit: 1, message: `No saved conversation ${o.id}.` }; } catch (e) { return { exit: 1, message: String((e as Error).message ?? e).split('\n')[0]! }; } }
  const list = store.list(undefined, 20); return list.length ? { pick: list } : { exit: 1, message: 'No saved conversations yet.' };
}

/** The plain picker: a numbered list of the last 20, then a number (or nothing to cancel). */
export async function pickSession(list: SessionMeta[], io: { input: NodeJS.ReadableStream; output: NodeJS.WritableStream }, now = Date.now()): Promise<string | undefined> {
  list.forEach((m, i) => io.output.write(`${String(i + 1).padStart(2)}  ${m.title}  ·  ${m.messages} msg  ·  ${ago(m.updatedAt, now)}  ·  ${m.cwd}\n`));
  io.output.write('Number to continue (enter to cancel): ');
  const rl = createInterface({ input: io.input }); const line = await new Promise<string>((res) => { rl.once('line', res); rl.once('close', () => res('')); }); rl.close();
  const n = Number(line.trim()); return Number.isInteger(n) && n >= 1 && n <= list.length ? list[n - 1]!.id : undefined;
}
