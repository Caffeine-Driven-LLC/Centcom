/** File locks arbitrated on `path_hmac`: the first acquire wins, others are denied, a lock ends on release or when its ttl runs out. */
export interface Lock { pathHmac: string; agentId: string; member: string; expiresAt: number }
export interface Clock { now(): number; setTimeout(fn: () => void, ms: number): unknown; clearTimeout(h: never): void }
export class LockArbiter {
  private locks = new Map<string, Lock & { timer: unknown }>();
  constructor(private readonly clock: Clock, private readonly onExpire: (l: Lock) => void) {}
  list(): Lock[] { return [...this.locks.values()].map(({ timer: _t, ...l }) => { void _t; return l; }); }
  /** `granted` also for the agent that already holds it (its ttl restarts). */
  acquire(pathHmac: string, agentId: string, member: string, ttlMs: number): 'granted' | 'denied' {
    const cur = this.locks.get(pathHmac); if (cur && cur.agentId !== agentId) return 'denied'; if (cur) this.clock.clearTimeout(cur.timer as never);
    const lock = { pathHmac, agentId, member, expiresAt: this.clock.now() + ttlMs }; const timer = this.clock.setTimeout(() => { const now = this.locks.get(pathHmac); if (now && now.agentId === agentId) { this.locks.delete(pathHmac); this.onExpire({ pathHmac, agentId, member, expiresAt: lock.expiresAt }); } }, ttlMs); this.locks.set(pathHmac, { ...lock, timer }); return 'granted';
  }
  release(pathHmac: string, agentId: string, member: string): boolean { const cur = this.locks.get(pathHmac); if (!cur || cur.agentId !== agentId || cur.member !== member) return false; this.clock.clearTimeout(cur.timer as never); this.locks.delete(pathHmac); return true; }
  /** a member went for good or was removed: their locks end */
  dropMember(member: string): Lock[] { const gone: Lock[] = []; for (const [k, l] of this.locks) if (l.member === member) { this.clock.clearTimeout(l.timer as never); this.locks.delete(k); gone.push({ pathHmac: l.pathHmac, agentId: l.agentId, member: l.member, expiresAt: l.expiresAt }); } return gone; }
  stop(): void { for (const l of this.locks.values()) this.clock.clearTimeout(l.timer as never); this.locks.clear(); }
}
