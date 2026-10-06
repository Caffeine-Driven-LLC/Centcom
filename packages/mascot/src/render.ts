/**
 * Pixel rows -> terminal text. Two vertical pixels per cell using the upper-half block, so a 12x12 Cento is
 * 12 columns by 6 rows (lane C033). Tiers follow @centcom/theme: truecolor, 256, 16, and an ASCII fallback.
 */
import { sgr, type ColorTier } from '@centcom/theme';
import { PAL_HEX } from './palette.js';

const RESET = '\x1b[0m';

/** ANSI strings, one per terminal row. Transparent pixels ('.') draw nothing. */
export function renderHalfBlock(rows: readonly string[], tier: ColorTier): string[] {
  if (tier === 'none') return renderPlain(rows);
  const out: string[] = [];
  const h = rows.length + (rows.length % 2);
  for (let y = 0; y < h; y += 2) {
    const top = rows[y] ?? '', bot = rows[y + 1] ?? '';
    const w = Math.max(top.length, bot.length);
    let line = '';
    let cur = '';
    const emit = (code: string, ch: string) => { if (code !== cur) { line += code ? `\x1b[${code}m` : RESET; cur = code; } line += ch; };
    for (let x = 0; x < w; x++) {
      const t = top[x] ?? '.', b = bot[x] ?? '.';
      const tc = t !== '.' ? PAL_HEX[t] : undefined, bc = b !== '.' ? PAL_HEX[b] : undefined;
      if (tc && bc) emit(tc === bc ? sgr(tc, tier, 'fg') : `${sgr(tc, tier, 'fg')};${sgr(bc, tier, 'bg')}`, tc === bc ? '█' : '▀');
      else if (tc) emit(sgr(tc, tier, 'fg'), '▀');
      else if (bc) emit(sgr(bc, tier, 'fg'), '▄');
      else emit('', ' ');
    }
    if (cur) line += RESET;
    out.push(line);
  }
  return out;
}

/** Colour-free rendering: shaded blocks by lightness, readable with NO_COLOR. */
export function renderPlain(rows: readonly string[]): string[] {
  const out: string[] = [];
  for (let y = 0; y < rows.length; y += 2) {
    const top = rows[y] ?? '', bot = rows[y + 1] ?? '';
    let line = '';
    for (let x = 0; x < Math.max(top.length, bot.length); x++) {
      const t = (top[x] ?? '.') !== '.', b = (bot[x] ?? '.') !== '.';
      line += t && b ? '█' : t ? '▀' : b ? '▄' : ' ';
    }
    out.push(line.replace(/\s+$/, ''));
  }
  return out;
}

/** Tiny text mascot for terminals too small for the sprite (lane C033 fallback). */
export const ASCII_CENTO: Record<string, string[]> = {
  idle: ['  ¡', '(•_•)', '/|||\\'],
  happy: ['  ¡', '(^_^)', '/|||\\'],
  thinking: ['  ¡', '(•_•?)', '/|||\\'],
  error: ['  ¡', '(x_x)', '/|||\\'],
  sleeping: ['  ¡', '(-_-)zZ', '/|||\\'],
  working: ['  ¡', '(•_•)', '/|||\\ ⌨'],
};

/** Stable pixel width of a rendered row set (columns). */
export function pixelWidth(rows: readonly string[]): number { return rows.reduce((m, r) => Math.max(m, r.length), 0); }
