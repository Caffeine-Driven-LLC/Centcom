/**
 * The people of a workspace and what the plan allows, for the app's Team panel: the members with their roles, the invites still open, the
 * plan and seats, and whether the relay is part of the plan. Invites and role changes are the owner's and admins' (the server decides);
 * every failure comes back as a sentence a person can act on. Nothing here is cached: each call asks the server.
 */
import type { HttpClient } from '@centcom/net';

export type TeamRole = 'admin' | 'member' | 'billing' | 'guest';
export const TEAM_ROLES: readonly TeamRole[] = ['admin', 'member', 'billing', 'guest'];
export interface TeamMember { id: string; name: string; email?: string; role: string; you: boolean }
export interface TeamInvite { id: string; email: string | null; role: string; expiresAt: string }
export interface TeamView {
  workspace: { id: string; name: string | null };
  plan: string; status: string; seats: { used: number; max: number | null }; relayAccess: boolean;
  /** the signed-in person's role here; only owners and admins manage people */ myRole: string; canManage: boolean;
  members: TeamMember[]; invites: TeamInvite[];
}
export interface TeamDeps { http: HttpClient; baseUrl: string; me: { id: string; workspace?: { id: string } }; billingUrl?: string }

const code = (e: unknown): string => (e as { code?: string; rawCode?: string })?.code ?? (e as { rawCode?: string })?.rawCode ?? '';
/** What went wrong, in words (the server's own code decides; an unknown one gets a generic sentence). */
export function teamWhy(e: unknown): string {
  const c = code(e); const msg = e instanceof Error ? e.message : '';
  if (c === 'seat_limit_reached') return 'Your plan has no seat left. Remove someone or add seats first.';
  if (c === 'member_exists') return 'That person is already in this workspace.';
  if (c === 'entitlement_required') return 'Your plan does not include this.';
  if (c === 'forbidden' || c === 'role_insufficient') return 'Only an owner or admin can do this, and this sign-in may not manage the team from the app yet: use the web app.';
  if (c === 'validation_failed' || c === 'invalid_request') return 'That did not look right. Check the e-mail address.';
  if (c === 'not_found' || c === 'workspace_not_found') return 'That was not found any more. Reload the team.';
  if (/fetch failed|ECONNREFUSED|network/i.test(msg)) return 'Could not reach the Centcom server. Check your connection.';
  return msg && msg.length < 140 ? msg : 'That did not work. Try again.';
}
const newKey = (): string => globalThis.crypto.randomUUID();
type Call = (op: string, args: unknown) => Promise<{ data: unknown }>;

export class Team {
  constructor(private readonly d: TeamDeps) {}
  private get call(): Call { return ((op: string, args: unknown) => (this.d.http as unknown as { call: Call }).call(op, args)); }
  private ws(): string { const id = this.d.me.workspace?.id; if (!id) throw Object.assign(new Error('No workspace is selected for this account.'), { code: 'workspace_not_found' }); return id; }

  async load(): Promise<TeamView> {
    const id = this.ws(); const call = this.call;
    const [w, mem, inv, ent, sub] = await Promise.all([
      call('getWorkspace', { path: { id } }).then((r) => r.data as { name?: string }, () => ({}) as { name?: string }),
      call('listMembers', { path: { id } }).then((r) => (r.data as { data?: Record<string, unknown>[] }).data ?? []),
      call('listInvites', { path: { id } }).then((r) => (r.data as { data?: Record<string, unknown>[] }).data ?? [], () => null),
      call('getEntitlements', { path: { id } }).then((r) => r.data as { plan?: string; status?: string; limits?: Record<string, unknown> }, () => ({}) as { plan?: string; status?: string; limits?: Record<string, unknown> }),
      call('getSubscription', { path: { id } }).then((r) => r.data as { seats?: number }, () => ({}) as { seats?: number }),
    ]);
    const members: TeamMember[] = mem.map((m) => ({ id: String(m.id), name: String(m.display_name ?? m.id), ...(typeof m.email === 'string' ? { email: m.email } : {}), role: String(m.role), you: m.user === this.d.me.id }));
    const mine = members.find((m) => m.you)?.role ?? 'member'; const limits = ent.limits ?? {};
    const maxSeats = typeof limits['max_seats'] === 'number' ? (limits['max_seats'] as number) : typeof sub.seats === 'number' ? sub.seats : null;
    return {
      workspace: { id, name: w.name ?? null }, plan: ent.plan ?? 'free', status: ent.status ?? 'active', seats: { used: members.length, max: maxSeats }, relayAccess: limits['relay_access'] === true,
      myRole: mine, canManage: mine === 'owner' || mine === 'admin', members,
      invites: (inv ?? []).filter((i) => i.status === 'pending' && !i.session).map((i) => ({ id: String(i.id), email: typeof i.email === 'string' ? i.email : null, role: String(i.role), expiresAt: String(i.expires_at) })),
    };
  }
  async invite(email: string, role: TeamRole): Promise<{ url?: string; email: string }> {
    const e = email.trim(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) || e.length > 254) throw Object.assign(new Error('That does not look like an e-mail address.'), { code: 'validation_failed' });
    if (!TEAM_ROLES.includes(role)) throw Object.assign(new Error('Unknown role.'), { code: 'validation_failed' });
    const r = (await this.call('createInvite', { path: { id: this.ws() }, body: { email: e, role }, headers: { 'Idempotency-Key': newKey() } })).data as { url?: string; token?: string };
    const url = r.url ?? (r.token ? `https://centcom.dev/i/${r.token}` : undefined); return { ...(url ? { url } : {}), email: e };
  }
  async revoke(invite: string): Promise<void> { await this.call('revokeInvite', { path: { id: this.ws(), invite } }); }
  async setRole(member: string, role: TeamRole): Promise<void> { if (!TEAM_ROLES.includes(role)) throw Object.assign(new Error('Unknown role.'), { code: 'validation_failed' }); await this.call('updateMember', { path: { id: this.ws(), mem: member }, body: { role } }); }
  async remove(member: string): Promise<void> { await this.call('removeMember', { path: { id: this.ws(), mem: member } }); }
  /** Where to upgrade: the hosted checkout when the server gives one, else the billing page (CENTCOM_BILLING_URL or centcom.dev/billing). Always https. */
  async upgradeUrl(plan: 'pro' | 'team' = 'pro'): Promise<string> {
    const fallback = this.d.billingUrl ?? 'https://centcom.dev/billing';
    try { const r = (await this.call('createCheckout', { path: { id: this.ws() }, body: { plan, seats: 1, interval: 'month', currency: 'USD' }, headers: { 'Idempotency-Key': newKey() } })).data as { url?: string }; if (r.url && /^https:\/\//.test(r.url)) return r.url; } catch { /* fall back */ }
    return fallback;
  }
}
