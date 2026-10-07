/** Who is in the session as the host sees it, with a stable slot for each member. */
import type { ConnectedMember, HostMember } from '@centcom/lan';
export interface RosterEntry { id: string; name: string; slot: number; role: HostMember['role']; device?: string; connected: boolean }
export class HostRoster {
  private m = new Map<string, RosterEntry>(); version = 0;
  constructor(host: HostMember) { this.m.set(host.id, { id: host.id, name: host.name, slot: host.slot, role: host.role, connected: true }); }
  connected(c: ConnectedMember): boolean { const first = !this.m.has(c.memberId); this.m.set(c.memberId, { id: c.memberId, name: c.name, slot: c.slot, role: c.role, device: c.deviceId, connected: true }); this.version++; return first; }
  disconnected(id: string): void { const e = this.m.get(id); if (e) { e.connected = false; this.version++; } }
  remove(id: string): void { this.m.delete(id); this.version++; }
  setRole(id: string, role: HostMember['role']): void { const e = this.m.get(id); if (e) { e.role = role; this.version++; } }
  get(id: string): RosterEntry | undefined { return this.m.get(id); }
  hostId(): string | undefined { return [...this.m.values()].find((e) => e.role === 'host')?.id; }
  deviceOf(id: string): string | undefined { return this.m.get(id)?.device; }
  list(): RosterEntry[] { return [...this.m.values()].sort((a, b) => a.slot - b.slot); }
  frame(): { version: number; members: Record<string, unknown>[] } { return { version: this.version, members: this.list().map((e) => ({ id: e.id, name: e.name, slot: e.slot, role: e.role, ...(e.device ? { device: e.device } : {}), connected: e.connected })) }; }
}
