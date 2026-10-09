import tokens from './tokens.json' with { type: 'json' };
import type { ColorTier } from './color.js';

export type ThemeMode = 'dark' | 'light' | 'hc';

/** High contrast: pure black grounds, white text and borders, a lighter link colour. Everything else (status and accent colours) stays as in the dark theme. */
const HC: Record<string, string> = { 'bg.base': '#000000', 'bg.surface': '#000000', 'bg.raised': '#000000', 'bg.overlay': '#000000', 'bg.sunken': '#000000', 'bg.hover': '#262626', 'bg.selected': '#3A3A3A', 'border.subtle': '#FFFFFF', 'border.default': '#FFFFFF', 'border.strong': '#FFFFFF', 'text.primary': '#FFFFFF', 'text.secondary': '#FFFFFF', 'text.muted': '#D0D0D0', 'text.inverse': '#000000', 'text.link': '#8CCBFF', 'focus.ring': '#FFFFFF' };

/** Semantic token names from contracts-independent design tokens (assets/theme/tokens.json). */
export type SemanticToken = keyof typeof tokens.semantic;

export interface Theme {
  readonly mode: ThemeMode;
  readonly tier: ColorTier;
  /** Hex colour for a semantic token, e.g. theme.c('text.primary'). */
  c(name: SemanticToken): string;
  /** The five Cento body colours in presence order (self first). */
  readonly presence: readonly string[];
}

const PRESENCE_ORDER = ['violet', 'red', 'yellow', 'green', 'brown'] as const;

export function createTheme(mode: ThemeMode, tier: ColorTier): Theme {
  const sem = tokens.semantic as Record<string, { dark: string; light: string }>;
  return {
    mode,
    tier,
    c(name) {
      const t = sem[name];
      if (!t) throw new Error(`unknown theme token ${String(name)}`);
      return mode === 'hc' ? (HC[name as string] ?? t.dark) : t[mode];
    },
    presence: PRESENCE_ORDER.map((k) => (tokens.presence as Record<string, string>)[k]!),
  };
}

export { tokens };
