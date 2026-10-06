/** The REST side of sessions: create, list, end, join tokens, members, share links, key bundles, snapshots and history. */
import type { HttpClient } from '../http/types.js';
import type { DeviceKeysInfo, MemberInfo, SessionPolicy, SessionSummary, SnapshotMeta } from './types.js';

export interface JoinToken { ticket: string; relay_url: string; member: string; role: string; expires_in?: number; region?: string; caps?: string[] }
export interface SessionCreated extends SessionSummary { host_member: { id: string; role: string; slot: number; device?: string; device_keys?: DeviceKeysInfo; display_name?: string }; relay_url?: string; region_hint?: string }
export interface HistoryPage { data: unknown[]; next_cursor: string | null; has_more: boolean; head_seq?: number; earliest_seq?: number }
export interface SnapshotUpload { snp: string; upload_url: string; expires_in: number }
export interface SnapshotDescriptor extends SnapshotMeta { download_url?: string; expires_in?: number }

type Rec = Record<string, unknown>;
export function memberOf(m: Rec): MemberInfo {
  const k = m.device_keys as Rec | undefined; const device = (m.device ?? k?.device) as string | undefined;
  return { id: String(m.id), role: (m.role as MemberInfo['role']) ?? 'editor', slot: Number(m.slot ?? 0), ...(m.display_name ? { name: String(m.display_name) } : {}), ...(device ? { device } : {}), ...(k && typeof k.x25519 === 'string' && typeof k.ed25519 === 'string' && device ? { keys: { device, x25519: k.x25519, ed25519: k.ed25519, ...(typeof k.fingerprint === 'string' ? { fingerprint: k.fingerprint } : {}), ...(k.revoked === true ? { revoked: true } : {}) } } : {}) };
}
export class SessionRest {
  constructor(private readonly http: HttpClient) {}
  /** One POST with an Idempotency-Key (the HTTP client keeps the same key across its own retries). A plan without relay access is a `relay_not_included`-style entitlement error from the server. */
  async create(o: { workspace: string; name: string; policy?: SessionPolicy; region_preference?: string }, signal?: AbortSignal): Promise<SessionCreated> { return (await this.http.call('createSession', { body: { workspace: o.workspace, name: o.name, ...(o.policy ? { policy: o.policy } : {}), ...(o.region_preference ? { region_preference: o.region_preference } : {}) } } as never, { signal })).data as unknown as SessionCreated; }
  async get(id: string): Promise<SessionSummary> { return (await this.http.call('getSession', { path: { id } } as never)).data as unknown as SessionSummary; }
  list(filter: { workspace?: string; state?: string; mine?: boolean } = {}): AsyncIterable<SessionSummary> { return this.http.paginate('listSessions', { query: { ...(filter.workspace ? { workspace: filter.workspace } : {}), ...(filter.state ? { state: filter.state } : {}), ...(filter.mine !== undefined ? { mine: filter.mine } : {}) } } as never) as unknown as AsyncIterable<SessionSummary>; }
  async update(id: string, body: { name?: string; policy?: SessionPolicy }): Promise<SessionSummary> { return (await this.http.call('updateSession', { path: { id }, body } as never)).data as unknown as SessionSummary; }
  async end(id: string): Promise<SessionSummary> { return (await this.http.call('endSession', { path: { id } } as never)).data as unknown as SessionSummary; }
  async claimHost(id: string): Promise<SessionSummary> { return (await this.http.call('claimHost', { path: { id } } as never)).data as unknown as SessionSummary; }
  /** Called for every connection attempt: a ticket works once. */
  async joinToken(id: string, caps?: string[], signal?: AbortSignal): Promise<JoinToken> { return (await this.http.call('createJoinToken', { path: { id }, body: caps ? { caps } : {} } as never, { signal })).data as unknown as JoinToken; }
  async members(id: string): Promise<MemberInfo[]> { const out: MemberInfo[] = []; for await (const m of this.http.paginate('listSessionMembers', { path: { id } } as never, { limit: 200 })) out.push(memberOf(m as unknown as Rec)); return out; }
  async createShareLink(id: string, expiresInS?: number): Promise<{ token: string; url: string; expires_at: string }> { return (await this.http.call('createShareLink', { path: { id }, body: expiresInS ? { expires_in_s: expiresInS } : {} } as never)).data as never; }
  async revokeShareLink(id: string, token: string): Promise<void> { await this.http.call('revokeShareLink', { path: { id, token } } as never); }
  async joinViaShareLink(token: string, displayName: string): Promise<JoinToken> { return (await this.http.call('joinViaShareLink', { path: { token }, body: { display_name: displayName } } as never)).data as unknown as JoinToken; }
  async putKeyBundle(inviteId: string, bundle: string): Promise<void> { await this.http.call('putInviteKeyBundle', { path: { id: inviteId }, body: { bundle } } as never); }
  async getKeyBundle(token: string): Promise<string> { return ((await this.http.call('getInviteKeyBundle', { path: { token } } as never)).data as unknown as { bundle: string }).bundle; }
  async snapshot(id: string): Promise<SnapshotDescriptor | null> { try { return (await this.http.call('getSnapshot', { path: { id } } as never)).data as unknown as SnapshotDescriptor; } catch (e) { if ((e as { status?: number }).status === 404) return null; throw e; } }
  async beginSnapshot(id: string, o: { kid: string; size: number }): Promise<SnapshotUpload> { return (await this.http.call('beginSnapshotUpload', { path: { id }, body: o } as never)).data as unknown as SnapshotUpload; }
  async commitSnapshot(id: string, snp: string, body: { seq: number; sha256: string; size: number; kid: string }): Promise<SnapshotDescriptor> { return (await this.http.call('commitSnapshot', { path: { id, snp }, body } as never)).data as unknown as SnapshotDescriptor; }
  async historyPage(id: string, o: { afterSeq: number; cursor?: string; limit?: number }): Promise<HistoryPage> { return (await this.http.call('getSessionHistory', { path: { id }, query: { after_seq: o.afterSeq, ...(o.cursor ? { cursor: o.cursor } : {}), limit: o.limit ?? 200 } } as never)).data as unknown as HistoryPage; }
}
