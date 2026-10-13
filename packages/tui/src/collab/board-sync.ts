/**
 * Keeps the local context board (docs/context-sharing.md) in step with the other people of a shared session, in branch mode:
 *
 *   out:  a note a person adds (`/note`, the Shared notes box) goes out as `board.note` (type clear; text and file references encrypted),
 *         pinning it as `board.pin`, taking it off as `board.remove`. Notes agents add on their own stay on this computer.
 *   in:   a `board.note` of a host or editor is added to this board with its author's name and role and its frame id (so pin and
 *         remove can name it); `board.pin` from a host or editor and `board.remove` from the host or the note's author change it.
 *
 * Received text is untrusted: it goes through the same filter as every note (control codes, markup, secrets, 280 characters) and is
 * delivered to agents inside the delimited, labelled digest. A viewer cannot send (the relay refuses, and this class does not try).
 * Frames from a role that may not send them are ignored, whatever the relay did.
 */
import type { Board, BoardChange, EntryType } from '@centcom/agent';
import { cleanPath, cleanText } from '@centcom/agent';
import type { DecodedEvent, MemberInfo } from '@centcom/net';

const SHARED_TYPES: readonly EntryType[] = ['decision', 'warning', 'finding'];
const MAY_WRITE = new Set(['host', 'editor']);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const strings = (v: unknown, max: number): string[] => (Array.isArray(v) ? v.map(str).filter(Boolean).slice(0, max) : []);

export interface BoardSyncDeps {
  board: Board; me: string; /** this person's own role (the roster may not list them yet) */ myRole(): string; roster(): readonly MemberInfo[];
  /** sends one frame; the id is the `msg_` id of the frame */ emit(kind: string, body: { p?: Record<string, unknown>; secret?: Record<string, unknown>; id?: string }): void;
  newId(): string; onChange?(): void;
}

export class BoardSync {
  /** local entry id -> frame id, for notes this person sent */ private wire = new Map<string, string>();
  /** frame id -> who sent the note */ private authors = new Map<string, string>();
  /** frame id of a note sent again for a late joiner -> the local id of the note that was already here */ private alias = new Map<string, string>();
  private off?: () => void;
  constructor(private readonly d: BoardSyncDeps) {}

  start(): void { this.off = this.d.board.subscribe((c) => this.onLocal(c)); }
  stop(): void { this.off?.(); this.off = undefined; }
  private role(member: string): string { if (member === this.d.me) return this.d.myRole(); return this.d.roster().find((m) => m.id === member)?.role ?? ''; }
  private canWrite(member: string): boolean { return MAY_WRITE.has(this.role(member)); }
  /** The id other people know a local entry by. */
  private targetOf(id: string): string | undefined { return this.wire.get(id) ?? (this.authors.has(id) ? id : undefined); }

  /* ---------------------------------------------------------------- out */
  private onLocal(c: BoardChange): void {
    if (c.remote || !this.canWrite(this.d.me)) return;
    if (c.op === 'post') {
      const e = c.entry; if (e.author.kind !== 'person' || !SHARED_TYPES.includes(e.type)) return;
      const id = this.d.newId(); this.wire.set(e.id, id); this.authors.set(id, this.d.me);
      const sup = e.supersedes ? this.targetOf(e.supersedes) : undefined; const refs = { files: e.refs.files, commands: e.refs.commands };
      this.d.emit('board.note', { id, p: { type: e.type, ...(sup ? { supersedes: sup } : {}) }, secret: { text: e.text, ...(refs.files.length || refs.commands.length ? { refs } : {}) } });
      if (e.pinned) this.d.emit('board.pin', { p: { target: id, pinned: true } });
      return;
    }
    const target = this.targetOf(c.id); if (!target) return;
    if (c.op === 'pin') this.d.emit('board.pin', { p: { target, pinned: c.pinned } });
    else if (this.role(this.d.me) === 'host' || this.authors.get(target) === this.d.me) this.d.emit('board.remove', { p: { target } });
  }

  /** Somebody joined: sends this person's live notes (the newest ten) again, so they have them even when the history could not be read. Receivers that already have a note see the same text from the same author and keep one copy. */
  resend(): void {
    if (!this.canWrite(this.d.me)) return;
    const mine = this.d.board.list().filter((e) => this.wire.has(e.id)).slice(-10);
    for (const e of mine) { const old = this.wire.get(e.id)!; this.wire.delete(e.id); this.alias.set(old, e.id); this.onLocal({ op: 'post', entry: e, remote: false }); }
  }

  /* ---------------------------------------------------------------- in */
  onEvent(e: DecodedEvent): void {
    try {
      if (e.kind === 'board.note') this.note(e);
      else if (e.kind === 'board.pin') this.pin(e);
      else if (e.kind === 'board.remove') this.remove(e);
    } catch { /* a malformed frame is ignored */ }
  }
  private note(e: DecodedEvent): void {
    if (!this.canWrite(e.from) || this.authors.has(e.id)) return;
    const type = str(e.p?.['type']) as EntryType; if (!SHARED_TYPES.includes(type)) return;
    const text = cleanText(e.secret?.['text']); if (!text) return;
    const board = this.d.board;
    const twin = board.list().find((x) => x.type === type && x.text === text && x.author.kind === 'person' && (x.author.id === e.from || (e.from === this.d.me && x.author.id === 'you')));
    if (twin) { this.authors.set(e.id, e.from); this.alias.set(e.id, twin.id); return; } // the same note again (sent anew for somebody who joined later): later pin and remove may name either id
    const m = this.d.roster().find((r) => r.id === e.from); const refs = e.secret?.['refs'] as { files?: unknown; commands?: unknown } | undefined;
    const sup = str(e.p?.['supersedes']); const supOk = sup && (this.authors.get(sup) === e.from || this.role(e.from) === 'host') ? sup : undefined;
    const files = strings(refs?.files, 8).map(cleanPath).filter((x): x is string => !!x);
    this.authors.set(e.id, e.from);
    const ts = Date.parse(e.ts);
    const made = board.post({ author: { kind: 'person', id: e.from, name: m?.name || 'Someone', role: this.role(e.from) }, type, text, files, commands: strings(refs?.commands, 3), scope: 'session', remote: { id: e.id, ...(Number.isFinite(ts) ? { ts } : {}) }, ...(supOk ? { supersedes: supOk } : {}) });
    if (made) this.d.onChange?.();
  }
  private pin(e: DecodedEvent): void {
    if (!this.canWrite(e.from) || e.from === this.d.me) return; const target = this.resolve(str(e.p?.['target'])); if (!target || typeof e.p?.['pinned'] !== 'boolean') return;
    if (this.d.board.pin(target, e.p['pinned'] as boolean, { remote: true })) this.d.onChange?.();
  }
  private remove(e: DecodedEvent): void {
    const wireId = str(e.p?.['target']); if (e.from === this.d.me || !wireId) return;
    if (this.role(e.from) !== 'host' && this.authors.get(wireId) !== e.from) return;
    const target = this.resolve(wireId); if (target && this.d.board.retract(target, { remote: true })) this.d.onChange?.();
  }
  /** The local id of a note named by its frame id (a note this person sent keeps its own local id). */
  private resolve(wireId: string): string | undefined { const al = this.alias.get(wireId); if (al && this.d.board.get(al)) return al; for (const [local, w] of this.wire) if (w === wireId) return local; return this.d.board.get(wireId) ? wireId : undefined; }
}
