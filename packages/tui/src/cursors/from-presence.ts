import type { MemberPresence } from '@centcom/net';
import type { CursorState, MemberId } from './model.js';
/** Turns the presence model (`PresenceClient.members()`) into cursor states: offline members and members without a cursor are not in it, so a member who left loses the cursor at once. */
export function cursorsFromPresence(members: ReadonlyMap<string, MemberPresence>): Map<MemberId, CursorState> {
  const out = new Map<MemberId, CursorState>(); for (const [id, m] of members) { if (m.status === 'offline' || !m.cursor) continue; out.set(id, { member: id, ...m.cursor, updatedAt: m.updatedAt }); } return out;
}
