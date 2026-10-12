/**
 * Someone else's conversation, seen from here: the transcript, the people and what is waiting, folded from the session's events
 * (the same reducer the browser page uses), and the two things a person may do: ask for something (an editor: it waits for the host)
 * and leave. A viewer sees everything and can send nothing.
 */
import { QueueClient, type SessionHandle } from '@centcom/net';
import { initialGuestState, reduceGuestState, type DecodedFrame, type GuestState } from '@centcom/guest';

export class JoinedSession {
  readonly queue: QueueClient; private st: GuestState; private readonly subs = new Set<(s: GuestState) => void>(); private readonly offs: (() => void)[] = []; private readonly pending = new Map<number, DecodedFrame>(); private last = 0; private gapTimer?: ReturnType<typeof setTimeout>; private held: DecodedFrame[] | undefined = []; private ready: Promise<void>;
  constructor(readonly handle: SessionHandle) {
    this.st = initialGuestState({ member: handle.me.id, slot: handle.me.slot, role: handle.me.role });
    this.queue = new QueueClient(handle);
    this.offs.push(
      handle.onAny((e) => { if (!e.seq) return; const f = { v: 1, t: 'event', id: e.id, sid: handle.id, from: e.from, ts: e.ts, k: e.kind, seq: e.seq, ...(e.p ? { p: e.p } : {}), ...(e.secret ? { secret: e.secret } : {}) } as unknown as DecodedFrame; if (this.held) { this.held.push(f); return; } this.feed([f]); }, { replay: true }),
      handle.on('state', (s) => this.set({ ...this.st, phase: s === 'live' ? (this.st.roster.length ? 'live' : 'connecting') : s === 'waiting_for_key' ? 'waiting_for_key' : s === 'reconnecting' ? 'reconnecting' : s === 'ended' ? 'ended' : this.st.phase })),
      handle.on('ended', (e) => this.set({ ...this.st, phase: e.code === 4403 ? 'kicked' : 'ended' })), handle.on('removed', () => this.set({ ...this.st, phase: 'kicked' })),
      handle.on('roster', () => this.set({ ...this.st })),
    );
    this.set({ ...this.st, phase: handle.state === 'live' ? 'live' : this.st.phase });
    // What was said before this person joined is fetched (when the host keeps history for them); the view then starts at the first frame it has.
    this.ready = Promise.race([handle.history.fetch(0), new Promise<number>((r) => setTimeout(() => r(0), 1500).unref?.())]).then(() => undefined, () => undefined).then(() => new Promise<void>((r) => setTimeout(r, 150))).then(() => this.release());
  }
  /** Resolves once the frames that were already there have been folded in. */
  get settled(): Promise<void> { return this.ready; }
  private release(): void { const frames = this.held ?? []; this.held = undefined; this.feed(frames); }
  /**
   * Frames are folded in order. The view starts at the first frame it has, and a frame this person may not see (the relay does not send
   * everything to everyone) leaves a gap: after a short wait the view goes on without it.
   */
  private feed(frames: DecodedFrame[]): void {
    for (const f of frames) { const seq = f.seq as number; if (seq > this.last && !this.pending.has(seq)) this.pending.set(seq, f); }
    if (this.last === 0 && this.pending.size) this.last = Math.min(...this.pending.keys()) - 1; this.drain();
    if (this.pending.size && !this.gapTimer) { this.gapTimer = setTimeout(() => { this.gapTimer = undefined; if (!this.pending.size) return; this.last = Math.min(...this.pending.keys()) - 1; this.drain(); }, 800); this.gapTimer.unref?.(); }
  }
  private drain(): void {
    let s = this.st; let any = false; for (let n = this.last + 1; this.pending.has(n); n++) { s = reduceGuestState(s, this.pending.get(n)!); this.pending.delete(n); this.last = n; any = true; }
    if (any) this.set({ ...s });
    if (this.pending.size && this.gapTimer === undefined) { this.gapTimer = setTimeout(() => { this.gapTimer = undefined; if (!this.pending.size) return; this.last = Math.min(...this.pending.keys()) - 1; this.drain(); }, 800); this.gapTimer.unref?.(); }
  }
  private set(s: GuestState): void { if (s === this.st && this.subs.size) return; this.st = s; for (const f of [...this.subs]) f(s); }
  state(): GuestState { return this.st; }
  subscribe(f: (s: GuestState) => void): () => void { this.subs.add(f); f(this.st); return () => { this.subs.delete(f); }; }
  /** People as the session client knows them (names, slots, roles), merged with who is shown as present. */
  people(): { id: string; name: string; slot: number; role: 'host' | 'editor' | 'viewer'; you: boolean; online: boolean }[] {
    const me = this.handle.me.id; return this.handle.roster().map((m) => ({ id: m.id, name: m.name || 'Someone', slot: m.slot, role: m.role, you: m.id === me, online: m.online !== false }));
  }
  get role(): 'host' | 'editor' | 'viewer' { return this.handle.me.role; }
  /** Asks the agent for something. Viewers cannot; the host decides on the rest. */
  async ask(text: string): Promise<{ item: string }> {
    const t = text.trim(); if (!t) throw new Error('Write something to ask for.'); if (this.role === 'viewer') throw Object.assign(new Error('You can watch this session but not send to it.'), { code: 'forbidden' });
    if (this.handle.muted().muted) throw Object.assign(new Error('The host has muted you for now.'), { code: 'muted' });
    return this.queue.submit({ body: t.slice(0, 60_000) });
  }
  async leave(): Promise<void> { if (this.gapTimer) clearTimeout(this.gapTimer); for (const o of this.offs.splice(0)) o(); this.queue.dispose(); this.subs.clear(); await this.handle.leave().catch(() => undefined); }
}
