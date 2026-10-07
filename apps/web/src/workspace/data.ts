/** The workspace calls, on the typed HTTP client. Everything the server says is shown as it comes: nothing is cached across people. */
export interface Http { call(op: string, args: Record<string, unknown>, o?: { idempotencyKey?: string; ifMatch?: string; signal?: AbortSignal }): Promise<{ data: unknown; etag?: string; replayed: boolean; status: number }>; listPage(op: string, args: Record<string, unknown>, o?: { signal?: AbortSignal }): Promise<{ data: unknown[]; next_cursor?: string | null; has_more: boolean }> }
export interface Member { id: string; user?: { id?: string; display_name?: string; email?: string }; role: string; joined_at?: string; created_at?: string }
export interface WorkspaceSettings { auto_approve: 'ask' | 'trusted' | 'everyone'; share_history: boolean; history_retention_days?: number | null }
export const PAGE_LIMIT = 50;
export const errCode = (e: unknown): string => (typeof (e as { code?: unknown })?.code === 'string' ? (e as { code: string }).code : ''); export const errStatus = (e: unknown): number => (e as { status?: number })?.status ?? 0;

/** Cursor paging for the member list: 50 a page, each person once, however often "Load more" is pressed. */
export class Pager<T extends { id: string }> {
  items: T[] = []; hasMore = true; loading = false; private cursor: string | undefined; private ids = new Set<string>(); error?: unknown;
  constructor(private readonly load: (cursor: string | undefined, limit: number) => Promise<{ data: T[]; next_cursor?: string | null; has_more: boolean }>) {}
  async loadMore(): Promise<void> {
    if (this.loading || !this.hasMore) return; this.loading = true; try { const p = await this.load(this.cursor, PAGE_LIMIT); for (const it of p.data) if (!this.ids.has(it.id)) { this.ids.add(it.id); this.items.push(it); } this.cursor = p.next_cursor ?? undefined; this.hasMore = p.has_more && !!p.next_cursor; this.error = undefined; } catch (e) { this.error = e; } finally { this.loading = false; }
  }
  reset(): void { this.items = []; this.ids.clear(); this.cursor = undefined; this.hasMore = true; this.error = undefined; }
}
export const membersPager = (http: Http, ws: string): Pager<Member> => new Pager<Member>((cursor, limit) => http.listPage('listMembers', { id: ws, limit, ...(cursor ? { cursor } : {}) }) as never);

export type SaveResult = { ok: true } | { ok: false; reason: 'changed_elsewhere' | 'forbidden' | 'invalid' | 'rate_limited' | 'gone' | 'error'; retryAfterS?: number };
/** The settings form: PATCH carries `If-Match` with the ETag that was loaded; a 412 is "Changed elsewhere" and nothing is overwritten. */
export class SettingsForm {
  etag?: string; value?: WorkspaceSettings; conflict?: { theirs: WorkspaceSettings; mine: Partial<WorkspaceSettings> };
  constructor(private readonly http: Http, private readonly ws: string) {}
  async load(): Promise<void> { const r = await this.http.call('getWorkspaceSettings', { id: this.ws }); this.value = r.data as WorkspaceSettings; this.etag = r.etag; this.conflict = undefined; }
  async save(patch: Partial<WorkspaceSettings>): Promise<SaveResult> {
    try { const r = await this.http.call('updateWorkspaceSettings', { id: this.ws, body: patch }, { ifMatch: this.etag }); this.value = r.data as WorkspaceSettings; this.etag = r.etag ?? this.etag; this.conflict = undefined; return { ok: true }; }
    catch (e) { const c = errCode(e); if (errStatus(e) === 412 || c === 'precondition_failed') { try { const r = await this.http.call('getWorkspaceSettings', { id: this.ws }); this.conflict = { theirs: r.data as WorkspaceSettings, mine: patch }; this.etag = r.etag; } catch { /* the form still says it changed */ } return { ok: false, reason: 'changed_elsewhere' }; } return { ok: false, ...failure(e) }; }
  }
  /** After "refresh and reapply": the newest values with my edits laid over them, saved against the new ETag. */
  async reapply(): Promise<SaveResult> { const mine = this.conflict?.mine; if (!mine) return { ok: true }; this.value = { ...(this.conflict!.theirs), ...mine }; return this.save(mine); }
}
export function failure(e: unknown): { reason: 'forbidden' | 'invalid' | 'rate_limited' | 'gone' | 'error'; retryAfterS?: number } {
  const c = errCode(e); const s = errStatus(e); if (s === 429 || c === 'rate_limited') return { reason: 'rate_limited', retryAfterS: (e as { retryAfterS?: number }).retryAfterS ?? 1 }; if (s === 403 || c === 'forbidden') return { reason: 'forbidden' }; if (s === 404) return { reason: 'gone' }; if (s === 400 || s === 422 || c === 'validation_failed') return { reason: 'invalid' }; return { reason: 'error' };
}
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** A ULID, for idempotency keys (a dialog keeps its key only while it is open). */
export function ulid(now = Date.now(), rand: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string { let t = ''; let n = now; for (let i = 0; i < 10; i++) { t = B32[n % 32] + t; n = Math.floor(n / 32); } let r = ''; for (const b of rand(16)) r += B32[b % 32]; return t + r; }
export interface InviteInput { email?: string; role: 'admin' | 'member' | 'billing' | 'guest'; share_history?: boolean }
export type InviteResult = { ok: true; invite: unknown; replayed: boolean } | { ok: false; reason: 'no_seats' | 'forbidden' | 'invalid' | 'rate_limited' | 'gone' | 'error'; retryAfterS?: number };
/** One invite dialog: the key is made when the dialog opens and kept until it closes, so a double click sends one request (the second call gets the same promise) and a retry replays. */
export class InviteDialog {
  readonly key: string; private inflight?: Promise<InviteResult>; private done?: InviteResult; requests = 0;
  constructor(private readonly http: Http, private readonly ws: string, mk: () => string = ulid) { this.key = mk(); }
  create(input: InviteInput): Promise<InviteResult> {
    if (this.done?.ok) return Promise.resolve(this.done); this.inflight ??= (async () => { this.requests++; try { const r = await this.http.call('createInvite', { id: this.ws, body: input }, { idempotencyKey: this.key }); this.done = { ok: true, invite: r.data, replayed: r.replayed }; return this.done; } catch (e) { const c = errCode(e); return c === 'seat_limit_reached' || c === 'entitlement_exceeded' || c === 'payment_required' || errStatus(e) === 402 ? { ok: false, reason: 'no_seats' } : { ok: false, ...failure(e) }; } finally { this.inflight = undefined; } })(); return this.inflight;
  }
}
/** Role change with the select reverting when the server says no. */
export async function changeRole(http: Http, ws: string, member: string, role: string): Promise<{ ok: true } | { ok: false; reason: string; retryAfterS?: number }> { try { await http.call('updateMember', { id: ws, mem: member, body: { role } }); return { ok: true }; } catch (e) { return { ok: false, ...failure(e) }; } }
export async function removeMember(http: Http, ws: string, member: string): Promise<{ ok: true } | { ok: false; reason: string }> { try { await http.call('removeMember', { id: ws, mem: member }); return { ok: true }; } catch (e) { return { ok: false, ...failure(e) }; } }
export async function transferOwnership(http: Http, ws: string, to: string): Promise<{ ok: true } | { ok: false; reason: string }> { try { await http.call('transferOwnership', { id: ws, body: { to } }, { idempotencyKey: ulid() }); return { ok: true }; } catch (e) { return { ok: false, ...failure(e) }; } }
export async function deleteWorkspace(http: Http, ws: string): Promise<{ ok: true } | { ok: false; reason: string }> { try { await http.call('deleteWorkspace', { id: ws }); return { ok: true }; } catch (e) { return { ok: false, ...failure(e) }; } }
export interface Invite { id: string; email?: string | null; role: string; status: string; share_history?: boolean; created_at: string; expires_at: string }
export const invitesPager = (http: Http, ws: string): Pager<Invite> => new Pager<Invite>((cursor, limit) => http.listPage('listInvites', { id: ws, limit, ...(cursor ? { cursor } : {}) }) as never);
export async function revokeInvite(http: Http, id: string): Promise<{ ok: true } | { ok: false; reason: string; retryAfterS?: number }> { try { await http.call('revokeInvite', { id }); return { ok: true }; } catch (e) { return { ok: false, ...failure(e) }; } }
export async function renameWorkspace(http: Http, ws: string, name: string): Promise<{ ok: true; name: string } | { ok: false; reason: string; retryAfterS?: number }> { try { const r = await http.call('updateWorkspace', { id: ws, body: { name } }); return { ok: true, name: (r.data as { name: string }).name ?? name }; } catch (e) { return { ok: false, ...failure(e) }; } }
/** The invite link, when the server made one (a link invite has no email). */
export const inviteLink = (invite: unknown): string | undefined => { const i = invite as { link?: unknown; url?: unknown } | undefined; return typeof i?.link === 'string' ? i.link : typeof i?.url === 'string' ? i.url : undefined; };
export interface MeLite { user?: { id?: string } }
/** Who is asking, from `GET /v1/me`: the member rows with this user id are "you". */
export async function whoAmI(http: Http): Promise<string | undefined> { try { const r = await http.call('getMe', {}); return (r.data as MeLite).user?.id; } catch { return undefined; } }
