/** The pinned colour choices for terminals with 256 or 16 colours (DESIGN 19.3). Everything else is found by nearest-colour search. */
import type { SemanticToken } from '@centcom/theme';

/** xterm-256 index for the 13 tokens the design lists. The colourful ones are the ones DESIGN names; the greys follow the shipped graphite palette (DESIGN's table still lists the retired navy greys). */
export const PINNED_256: Partial<Record<SemanticToken, number>> = {
  'bg.base': 233, 'bg.surface': 234, 'border.default': 238, 'text.primary': 255, 'text.secondary': 250, 'text.muted': 245,
  'accent.primary': 99, 'accent.fill': 63, 'signal': 86, 'status.success': 78, 'status.warning': 221, 'status.danger': 203, 'status.info': 75,
};
export type Ansi16 = 'black' | 'red' | 'green' | 'yellow' | 'blue' | 'magenta' | 'cyan' | 'white' | 'brightBlack' | 'brightWhite';
/** The ANSI slot for the same 13 tokens, so status colours follow the user's own terminal theme. */
export const PINNED_16: Partial<Record<SemanticToken, Ansi16>> = {
  'bg.base': 'black', 'bg.surface': 'black', 'border.default': 'brightBlack', 'text.primary': 'brightWhite', 'text.secondary': 'white', 'text.muted': 'brightBlack',
  'accent.primary': 'magenta', 'accent.fill': 'magenta', 'signal': 'cyan', 'status.success': 'green', 'status.warning': 'yellow', 'status.danger': 'red', 'status.info': 'blue',
};
export const ANSI_FG: Record<Ansi16, number> = { black: 30, red: 31, green: 32, yellow: 33, blue: 34, magenta: 35, cyan: 36, white: 37, brightBlack: 90, brightWhite: 97 };
/** Tokens that use ANSI names even on truecolor terminals (so they inherit the user's theme) unless `statusColors: 'hex'`. */
export const STATUS_TOKENS: SemanticToken[] = ['status.success', 'status.warning', 'status.danger', 'status.info', 'signal'];
/** DESIGN 19.5 high contrast. Status colours are their on-black equivalents. */
export const HC: Partial<Record<SemanticToken, string>> = {
  'bg.base': '#000000', 'bg.surface': '#000000', 'bg.raised': '#000000', 'bg.overlay': '#000000', 'bg.sunken': '#000000', 'border.subtle': '#FFFFFF', 'border.default': '#FFFFFF', 'border.strong': '#FFFFFF',
  'text.primary': '#FFFFFF', 'text.secondary': '#FFFFFF', 'text.muted': '#D4D4DA', 'accent.primary': '#9FD0FF', 'accent.hover': '#9FD0FF', 'signal': '#5FF5D2', 'focus.ring': '#FFFFFF',
  'status.success': '#4ADE80', 'status.warning': '#FFD166', 'status.danger': '#FF5C5C', 'status.info': '#9FD0FF',
};
