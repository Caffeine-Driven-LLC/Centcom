/** Member colours (DESIGN 3.2): you are violet, the others take red, yellow, green, brown in slot order skipping yours; a sixth person is violet with an outline. Derived from slots only, so it never changes during a session. */
import { tokens } from '@centcom/theme';

export type MemberColourName = 'violet' | 'red' | 'yellow' | 'green' | 'brown';
const P = tokens.presence as Record<MemberColourName, string>; const ORDER: MemberColourName[] = ['red', 'yellow', 'green', 'brown'];
export function memberColor(slot: number, selfSlot: number): { name: MemberColourName; hex: string; outlined: boolean } {
  if (slot === selfSlot) return { name: 'violet', hex: P.violet, outlined: false };
  const rank = slot - (slot > selfSlot ? 1 : 0); /* slots above yours shift down one: your own is never skipped over */
  const name = ORDER[rank]; return name ? { name, hex: P[name], outlined: false } : { name: 'violet', hex: P.violet, outlined: true };
}
