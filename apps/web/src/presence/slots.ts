/** Slot to colour (DESIGN.md 4.6): you are violet; the others take red, yellow, green, brown in slot order skipping you; a sixth person is violet with an outline and a different initial treatment. */
export type SlotColour = 'violet' | 'red' | 'yellow' | 'green' | 'brown' | 'violet-outlined';
const OTHERS: readonly SlotColour[] = ['red', 'yellow', 'green', 'brown'];
export function slotColour(slot: number, selfSlot: number): SlotColour { if (slot === selfSlot) return 'violet'; const rank = slot < selfSlot ? slot : slot - 1; return OTHERS[rank] ?? 'violet-outlined'; }
export const COLOUR_NAME: Record<SlotColour, string> = { violet: 'violet', red: 'red', yellow: 'yellow', green: 'green', brown: 'brown', 'violet-outlined': 'violet outline' };
/** The initial is white on violet and brown, ink on red, yellow and green. */
export const INITIAL_ON: Record<SlotColour, 'white' | 'ink'> = { violet: 'white', 'violet-outlined': 'white', brown: 'white', red: 'ink', yellow: 'ink', green: 'ink' };
/** Colours are the theme's variables, never raw values. */
export const VAR: Record<'violet' | 'red' | 'yellow' | 'green' | 'brown' | 'white' | 'ink' | 'ring', string> = { violet: 'var(--presence-violet)', red: 'var(--presence-red)', yellow: 'var(--presence-yellow)', green: 'var(--presence-green)', brown: 'var(--presence-brown)', white: 'var(--accent-on)', ink: 'var(--ink-900)', ring: 'var(--abyss-300)' };
export type Status = 'online' | 'away' | 'busy' | 'offline';
/** A different shape for every status, so colour is never the only difference. */
export const STATUS_GLYPH: Record<Status, string> = { online: '✓', away: '◷', offline: '–', busy: '−' };
export const STATUS_WORD: Record<Status, string> = { online: 'online', away: 'away', offline: 'offline', busy: 'busy' };
export const roleChip = (role: string): string => (role === 'host' ? 'HOST' : role === 'editor' ? 'EDIT' : 'VIEW');
/** `M · Maya · green`: the line the roster reads out. */
export const rosterLine = (name: string, colour: SlotColour): string => `${[...name.trim()][0]?.toUpperCase() ?? '?'} · ${name} · ${COLOUR_NAME[colour]}`;
export function activityText(activity: string, status: Status, since: number | undefined, now: number): string { if (status === 'away') { const m = since === undefined ? 0 : Math.max(0, Math.floor((now - since) / 60_000)); return m ? `away ${m}m` : 'away'; } return activity === 'typing' ? 'typing' : activity === 'reviewing' ? 'reviewing diff' : activity === 'running' ? 'running agents' : status === 'offline' ? 'offline' : ''; }
