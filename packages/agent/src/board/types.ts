/** The context board (docs/context-sharing.md): short entries that agents, people and Centcom post, and that Centcom delivers to the other agents. */
export type EntryType = 'decision' | 'warning' | 'finding' | 'claim' | 'question' | 'answer';
export const ENTRY_TYPES: readonly EntryType[] = ['decision', 'warning', 'finding', 'claim', 'question', 'answer'];
/** `agent`: only that agent; `fleet`: every agent on this computer; `session`: teammates too (a later phase). */
export type BoardScope = 'agent' | 'fleet' | 'session';
export interface Author { kind: 'agent' | 'person'; id: string; name: string; engine?: string; /** a teammate's role in the shared session (host, editor), for notes that came from another person */ role?: string }
export interface Entry {
  id: string; ts: number; author: Author; type: EntryType; text: string;
  refs: { files: string[]; commands: string[] }; scope: BoardScope; pinned: boolean; /** this note is in the shared session: sent to, or received from, the other people */ shared?: boolean; /** ms since the epoch; none = until retracted */ expires?: number; supersedes?: string;
}
export interface PostInput {
  author: Author; type: EntryType; text: string; files?: string[]; commands?: string[]; scope?: BoardScope; pinned?: boolean;
  /** Overrides the default lifetime of the type; 0 = until retracted. */ ttlMs?: number; supersedes?: string;
  /** A note that came from the shared session keeps the id of its frame (so pin and remove can name it) and its time, and is not sent back. */ remote?: { id: string; ts?: number };
}
/** What changed on the board, for whoever keeps it in step with other people (the session bridge). `remote` is true when the change itself came from the session. */
export type BoardChange = { op: 'post'; entry: Entry; remote: boolean } | { op: 'retract'; id: string; remote: boolean } | { op: 'pin'; id: string; pinned: boolean; remote: boolean };
/** What was delivered to an agent, ready to put in front of its prompt. */
export interface Digest { text: string; ids: string[]; count: number; /** relevant notes that did not fit the budget */ more: number; lines: string[] }
export interface DigestOptions { budgetTokens?: number }
