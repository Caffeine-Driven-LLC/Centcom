/** Styled output for every colour tier and theme. Components ask for a semantic token; this decides the hex, the 256 index, the ANSI name, or (without colour) bold/dim/reverse and glyphs. */
import { hexToRgb, nearest256, tokens, type SemanticToken } from '@centcom/theme';
import { ANSI_FG, HC, PINNED_16, PINNED_256, STATUS_TOKENS } from './tables.js';

export type ThemeMode = 'dark' | 'light' | 'hc'; export type ColourTier = 'truecolor' | '256' | '16' | 'none';
export type Token = SemanticToken;
export interface TokenStyle { color?: string; backgroundColor?: string; bold?: boolean; dimColor?: boolean; inverse?: boolean }
export type GlyphName = 'ok' | 'warn' | 'error' | 'info' | 'dot' | 'therefore' | 'corner' | 'note' | 'pointer' | 'h' | 'v' | 'cross';
const GLYPHS: Record<GlyphName, [string, string]> = { ok: ['✓', 'v'], warn: ['!', '!'], error: ['✗', 'x'], info: ['i', 'i'], dot: ['●', '*'], therefore: ['∴', '~'], corner: ['└', '\\'], note: ['※', '#'], pointer: ['▸', '>'], h: ['─', '-'], v: ['│', '|'], cross: ['┼', '+'] };
export type StatusKind = 'success' | 'warning' | 'danger' | 'info';
const STATUS_GLYPH: Record<StatusKind, GlyphName> = { success: 'ok', warning: 'warn', danger: 'error', info: 'info' };
export interface ThemeDeps { caps: { tier: ColourTier; unicode: boolean }; mode: ThemeMode | 'auto'; background?: 'dark' | 'light' | 'unknown'; statusColors?: 'ansi' | 'hex'; log?: { debug(m: string): void } }
export interface Theme {
  readonly mode: ThemeMode; readonly tier: ColourTier; style(token: Token): TokenStyle; paint(token: Token, text: string, extra?: { bold?: boolean; dim?: boolean; inverse?: boolean }): string; glyph(name: GlyphName): string;
  /** A status always says it in words and a glyph: `✗ error`. Colour only adds to it. */ status(kind: StatusKind, word: string): string;
  hex(token: Token): string; setMode(m: ThemeMode | 'auto'): void; subscribe(fn: () => void): () => void;
}
const SEM = tokens.semantic as Record<string, { dark: string; light: string }>;
export const toXterm256 = (hex: string): number => nearest256(hexToRgb(hex));
const isBg = (t: string) => t.startsWith('bg.') || t.endsWith('.subtle') && t.startsWith('status.') || t === 'accent.fill' || t === 'accent.subtle' || t === 'signal.subtle';

export function createTheme(d: ThemeDeps): Theme {
  const unknownSeen = new Set<string>(); const subs = new Set<() => void>(); const resolve = (m: ThemeMode | 'auto'): ThemeMode => (m === 'auto' ? (d.background === 'light' ? 'light' : 'dark') : m); let mode = resolve(d.mode); const sc = d.statusColors ?? 'ansi'; const tier = d.caps.tier;
  const known = (t: string): Token => { if (SEM[t]) return t as Token; if (!unknownSeen.has(t)) { unknownSeen.add(t); d.log?.debug('theme.unknown_token'); } return 'text.primary'; };
  const hex = (t: Token): string => (mode === 'hc' && HC[t] ? HC[t]! : SEM[t]![mode === 'light' ? 'light' : 'dark']);
  const ansiNamed = (t: Token) => (tier === '16' || (tier === 'truecolor' && STATUS_TOKENS.includes(t) && sc === 'ansi')) && mode !== 'hc';
  /** What colour a token is at this tier: an ANSI slot, a 256 index, or hex. */
  type Colour = { kind: 'named'; n: number } | { kind: '256'; n: number } | { kind: 'hex'; hex: string };
  function colour(t: Token): Colour | undefined {
    if (tier === 'none') return undefined; const h = hex(t);
    if (ansiNamed(t) && PINNED_16[t]) return { kind: 'named', n: ANSI_FG[PINNED_16[t]!] };
    if (tier === 'truecolor') return { kind: 'hex', hex: h };
    if (tier === '256') return { kind: '256', n: mode === 'dark' && PINNED_256[t] !== undefined ? PINNED_256[t]! : toXterm256(h) };
    return { kind: 'named', n: ANSI_FG[PINNED_16[t] ?? 'white'] };
  }
  const sgr = (c: Colour, bg: boolean): string => (c.kind === 'named' ? String(bg ? c.n + 10 : c.n) : c.kind === '256' ? `${bg ? 48 : 38};5;${c.n}` : `${bg ? 48 : 38};2;${hexToRgb(c.hex).join(';')}`);
  const theme: Theme = {
    get mode() { return mode; }, tier,
    hex: (t) => hex(known(t)),
    style(token) {
      const t = known(token); const bg = isBg(t); const c = colour(t);
      if (!c) return t === 'text.muted' ? { dimColor: true } : {}; /* no colour: dim and bold carry the difference */
      const v = c.kind === 'hex' ? c.hex : c.kind === '256' ? `ansi256(${c.n})` : INK_NAMES[String(c.n)]!; return bg ? { backgroundColor: v } : { color: v };
    },
    paint(token, text, extra = {}) {
      const t = known(token); const c = colour(t); const on: string[] = []; if (extra.bold) on.push('1'); if (extra.dim || (!c && t === 'text.muted')) on.push('2'); if (extra.inverse) on.push('7'); if (c) on.push(sgr(c, isBg(t)));
      return on.length ? `\u001b[${on.join(';')}m${text}\u001b[0m` : text;
    },
    glyph: (n) => GLYPHS[n][d.caps.unicode ? 0 : 1],
    status(kind, word) { return `${theme.glyph(STATUS_GLYPH[kind])} ${word}`; },
    setMode(m) { const next = resolve(m); if (next === mode) return; mode = next; for (const f of [...subs]) f(); },
    subscribe(fn) { subs.add(fn); return () => { subs.delete(fn); }; },
  };
  return theme;
}
/** ANSI foreground code to the colour name Ink understands. */
const INK_NAMES: Record<string, string> = { '30': 'black', '31': 'red', '32': 'green', '33': 'yellow', '34': 'blue', '35': 'magenta', '36': 'cyan', '37': 'white', '90': 'gray', '97': 'whiteBright' };
export { PINNED_256, PINNED_16 };
