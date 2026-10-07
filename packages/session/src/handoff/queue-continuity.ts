/** Items across a handoff or a failover (CT-WS-QUEUE host loss): what was running shows as approved to the new host, and nothing runs twice. */
export interface QueueItemLite { item: string; state: string; agent_id?: string; [k: string]: unknown }
export function adoptQueue<T extends QueueItemLite>(items: readonly T[]): T[] {
  return items.map((i) => (i.state === 'running' || i.state === 'held' ? { ...i, state: 'approved', agent_id: undefined } : i)) as T[];
}
/** The new host's runner asks here before it claims: an item is run by one agent, once. */
export class ClaimLedger {
  private claimed = new Map<string, string>();
  /** `true` the first time; a second claim of the same item (by anyone) is refused. */
  claim(item: string, agent: string): boolean { if (this.claimed.has(item)) return false; this.claimed.set(item, agent); return true; }
  holder(item: string): string | undefined { return this.claimed.get(item); }
  /** the item finished or was given back */
  release(item: string): void { this.claimed.delete(item); }
}
