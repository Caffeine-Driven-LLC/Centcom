import tokens from './tokens.json' with { type: 'json' };
import type { ColorTier } from './color.js';

export type ThemeMode = 'dark' | 'light';

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
      return t[mode];
    },
    presence: PRESENCE_ORDER.map((k) => (tokens.presence as Record<string, string>)[k]!),
  };
}

export { tokens };
