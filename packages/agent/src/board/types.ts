/** The context board (docs/context-sharing.md): short entries that agents, people and Centcom post, and that Centcom delivers to the other agents. */
export type EntryType = 'decision' | 'warning' | 'finding' | 'claim' | 'question' | 'answer';
export const ENTRY_TYPES: readonly EntryType[] = ['decision', 'warning', 'finding', 'claim', 'question', 'answer'];
/** `agent`: only that agent; `fleet`: every agent on this computer; `session`: teammates too (a later phase). */
export type BoardScope = 'agent' | 'fleet' | 'session';
export interface Author { kind: 'agent' | 'person'; id: string; name: string; engine?: string }
export interface Entry {
  id: string; ts: number; author: Author; type: EntryType; text: string;
  refs: { files: string[]; commands: string[] }; scope: BoardScope; pinned: boolean; /** ms since the epoch; none = until retracted */ expires?: number; supersedes?: string;
}
export interface PostInput {
  author: Author; type: EntryType; text: string; files?: string[]; commands?: string[]; scope?: BoardScope; pinned?: boolean;
  /** Overrides the default lifetime of the type; 0 = until retracted. */ ttlMs?: number; supersedes?: string;
}
/** What was delivered to an agent, ready to put in front of its prompt. */
export interface Digest { text: string; ids: string[]; count: number; /** relevant notes that did not fit the budget */ more: number; lines: string[] }
export interface DigestOptions { budgetTokens?: number }
