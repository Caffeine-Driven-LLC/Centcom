/** Who is in the session, with the device keys of each member. Fed by REST members and the server's control frames. */
import type { MemberInfo } from './types.js';

export class Roster {
  private byId = new Map<string, MemberInfo>(); version = 0;
  get(id: string | undefined): MemberInfo | undefined { return id ? this.byId.get(id) : undefined; }
  byDevice(device: string): MemberInfo | undefined { for (const m of this.byId.values()) if (m.device === device) return m; return undefined; }
  list(): MemberInfo[] { return [...this.byId.values()].sort((a, b) => a.slot - b.slot || a.id.localeCompare(b.id)); }
  /** Merge a member in; keys already known are kept when the update has none (a control frame carries no keys). */
  upsert(m: MemberInfo): MemberInfo { const old = this.byId.get(m.id); const next: MemberInfo = { ...old, ...m, ...(m.keys ? {} : old?.keys ? { keys: old.keys } : {}), ...(m.device || !old?.device ? {} : { device: old.device }) }; this.byId.set(m.id, next); return next; }
  remove(id: string): MemberInfo | undefined { const m = this.byId.get(id); this.byId.delete(id); return m; }
  /** `control.roster`: the server's full list replaces ours (keys of members we still have are kept). */
  replace(members: MemberInfo[], version?: number): void { const keep = new Map(this.byId); this.byId = new Map(); for (const m of members) { const old = keep.get(m.id); this.byId.set(m.id, { ...old, ...m, ...(m.keys ? {} : old?.keys ? { keys: old.keys } : {}) }); } if (version !== undefined) this.version = version; }
  setRole(id: string, role: MemberInfo['role']): void { const m = this.byId.get(id); if (m) m.role = role; }
  hostId(): string | undefined { return [...this.byId.values()].find((m) => m.role === 'host')?.id; }
  /** Devices of every member except `exceptDevice`, with keys, that may be given a session key. */
  recipients(exceptDevice?: string): MemberInfo[] { return this.list().filter((m) => m.role !== 'viewer' && m.keys && !m.keys.revoked && !m.keyChanged && m.device !== exceptDevice); }
}
