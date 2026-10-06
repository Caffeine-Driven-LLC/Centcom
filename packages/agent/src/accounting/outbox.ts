/** The usage outbox: `<data>/usage/outbox.jsonl`, at most 10,000 events. When full, token events go first, agent minutes last. Rewritten atomically. */
import type { UsageEvent } from './types.js';

export const OUTBOX_CAP = 10_000; export const BATCH_MAX = 500;
export interface OutboxFs { read(p: string): Promise<string | undefined>; writeAtomic(p: string, text: string): Promise<void> }
export class Outbox {
  private items: UsageEvent[] = []; private inFlight = new Map<string, UsageEvent>(); dropped = 0; private loaded = false; private dirty = false;
  constructor(private fs: OutboxFs, private path: string) {}
  async load(): Promise<void> {
    if (this.loaded) return; this.loaded = true; let text: string | undefined; try { text = await this.fs.read(this.path); } catch { text = undefined; }
    const seen = new Set<string>(); for (const line of (text ?? '').split('\n')) { if (!line.trim()) continue; try { const e = JSON.parse(line) as UsageEvent; if (typeof e?.id === 'string' && !seen.has(e.id) && ['agent_minutes', 'tokens_in', 'tokens_out'].includes(e.type) && Number.isInteger(e.qty) && e.qty >= 0) { seen.add(e.id); this.items.push(e); } } catch { /* a damaged line is skipped, the rest is kept */ } }
  }
  push(e: UsageEvent): void {
    this.items.push(e); this.dirty = true;
    while (this.items.length + this.inFlight.size > OUTBOX_CAP) { const i = this.items.findIndex((x) => x.type !== 'agent_minutes'); this.items.splice(i >= 0 ? i : 0, 1); this.dropped++; }
  }
  dequeue(max = BATCH_MAX): UsageEvent[] { const n = Math.max(0, Math.min(BATCH_MAX, max)); const out = this.items.splice(0, n); for (const e of out) this.inFlight.set(e.id, e); return out; }
  ack(ids: string[]): void { for (const id of ids) this.inFlight.delete(id); this.dirty = true; }
  requeue(ids: string[]): void { const back = ids.map((id) => this.inFlight.get(id)).filter((e): e is UsageEvent => !!e); for (const e of back) this.inFlight.delete(e.id); this.items.unshift(...back); }
  size(): number { return this.items.length + this.inFlight.size; }
  /** Everything not yet acknowledged (in flight too: a crash before the ack sends it again). */
  async save(): Promise<void> { if (!this.dirty) return; this.dirty = false; await this.fs.writeAtomic(this.path, [...this.inFlight.values(), ...this.items].map((e) => JSON.stringify(e)).join('\n') + (this.size() ? '\n' : '')); }
}
