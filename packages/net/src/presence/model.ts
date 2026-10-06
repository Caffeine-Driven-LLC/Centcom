/** Who is doing what, as far as we have heard. Everything here is best effort: nothing waits for it. */
export type PresenceStatus = 'online' | 'away' | 'busy' | 'offline'; export type PresenceActivity = 'idle' | 'typing' | 'reviewing' | 'running';
export interface CursorInfo { path?: string; line?: number; col?: number; selEndLine?: number; selEndCol?: number }
export interface MemberPresence { status: PresenceStatus; activity: PresenceActivity; agentCount?: number; cursor?: CursorInfo; updatedAt: number }
export const CURSOR_TTL_MS = 10_000;
const STATUS = new Set(['online', 'away', 'busy']); const ACTIVITY = new Set(['idle', 'typing', 'reviewing', 'running']);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

export class PresenceModel {
  private m = new Map<string, MemberPresence & { cursorAt?: number }>();
  /** `presence.update` replaces what we knew of that member; unknown words keep the old value. */
  update(member: string, p: Record<string, unknown>, now: number): MemberPresence {
    const old = this.m.get(member); const next = { status: (STATUS.has(String(p.status)) ? p.status : old?.status ?? 'online') as PresenceStatus, activity: (ACTIVITY.has(String(p.activity)) ? p.activity : old?.activity ?? 'idle') as PresenceActivity, ...(num(p.agent_count) !== undefined ? { agentCount: num(p.agent_count) } : {}), ...(old?.cursor ? { cursor: old.cursor, cursorAt: old.cursorAt } : {}), updatedAt: now };
    this.m.set(member, next); return this.strip(next);
  }
  /** `presence.cursor`: an empty body clears it. */
  cursor(member: string, s: Record<string, unknown>, now: number): MemberPresence {
    const old = this.m.get(member) ?? { status: 'online' as const, activity: 'idle' as const, updatedAt: now }; const c: CursorInfo = { ...(typeof s.path === 'string' ? { path: s.path } : {}), ...(num(s.line) !== undefined ? { line: num(s.line) } : {}), ...(num(s.col) !== undefined ? { col: num(s.col) } : {}), ...(num(s.sel_end_line) !== undefined ? { selEndLine: num(s.sel_end_line) } : {}), ...(num(s.sel_end_col) !== undefined ? { selEndCol: num(s.sel_end_col) } : {}) };
    const { cursor: _c, cursorAt: _a, ...rest } = old; void _c; void _a; const next = Object.keys(c).length ? { ...rest, cursor: c, cursorAt: now } : rest; this.m.set(member, { ...next, updatedAt: now }); return this.strip(this.m.get(member)!);
  }
  offline(member: string, now: number): MemberPresence { const old = this.m.get(member); const { cursor: _c, cursorAt: _a, ...rest } = old ?? { status: 'offline' as const, activity: 'idle' as const, updatedAt: now }; void _c; void _a; const next = { ...rest, status: 'offline' as const, activity: 'idle' as const, updatedAt: now }; this.m.set(member, next); return next; }
  remove(member: string): void { this.m.delete(member); }
  /** Drops cursors older than 10 s and returns the members whose cursor just went. */
  expire(now: number): string[] { const gone: string[] = []; for (const [k, v] of this.m) if (v.cursor && v.cursorAt !== undefined && now - v.cursorAt >= CURSOR_TTL_MS) { const { cursor: _c, cursorAt: _a, ...rest } = v; void _c; void _a; this.m.set(k, rest); gone.push(k); } return gone; }
  nextExpiry(): number | undefined { let t: number | undefined; for (const v of this.m.values()) if (v.cursorAt !== undefined) t = Math.min(t ?? Infinity, v.cursorAt + CURSOR_TTL_MS); return t; }
  members(now: number): Map<string, MemberPresence> { this.expire(now); return new Map([...this.m].map(([k, v]) => [k, this.strip(v)])); }
  private strip(v: MemberPresence & { cursorAt?: number }): MemberPresence { const { cursorAt: _a, ...rest } = v; void _a; return rest; }
}
