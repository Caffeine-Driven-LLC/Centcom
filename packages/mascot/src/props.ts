import { textRows } from './font.js';

/** Small pixel props placed next to Cento. Rows use the shared palette characters. */
export const PROPS: Record<string, string[]> = {
  heart: ['.p.p.', 'ppppp', '.ppp.', '..p..'],
  heart_s: ['p.p', 'ppp', '.p.'],
  spark_s: ['.Y.', 'YwY', '.Y.'],
  twinkle: ['.w.', 'www', '.w.'],
  bulb: ['.YYY.', 'YwYYY', 'YYYYY', '.YYY.', '..g..', '..g..'],
  check: ['....G', '...G.', 'G.G..', '.G...'],
  xmark_s: ['r.r', '.r.', 'r.r'],
  magnifier: ['.ggg..', 'gLLLg.', 'gLLLg.', '.ggg..', '....N.', '.....N'],
  gear_a: ['.Y.Y.', 'YYYYY', 'YYkYY', 'YYYYY', '.Y.Y.'],
  gear_b: ['Y.Y.Y', '.YYY.', 'YYkYY', '.YYY.', 'Y.Y.Y'],
  file: ['wwwwg.', 'wuuuww', 'wwwwww', 'wuuuuw', 'wwwwww', 'wuuuww', 'wwwwww'],
  pencil: ['....Y', '...Y.', '..Y..', '.O...', 'p....'],
  shield: ['bbbbb', 'bbwbb', 'bbwbb', 'bbwbb', '.bbb.', '..b..'],
  lock: ['.ggg.', 'g...g', 'g...g', 'YYYYY', 'YYkYY', 'YYYYY'],
  hourglass_a: ['wwwww', '.YYY.', '..Y..', '..w..', '.www.', 'wwwww'],
  hourglass_b: ['wwwww', '.www.', '..w..', '..Y..', '.YYY.', 'wwwww'],
  note: ['..bb', '..b.', '..b.', 'bbb.', 'bb..'],
  note_p: ['..pp', '..p.', '..p.', 'ppp.', 'pp..'],
  puff: ['g.g', '.g.', 'g.g'],
  cup: ['wwwww.', 'wNNNww', 'wNNNw.', '.www..'],
  box: ['NNNNNNN', 'NtttttN', 'NtttttN', 'NNNNNNN'],
  confetti_a: ['Y.p...c', '..b..r.', '.G....Y', 'p...c..'],
  confetti_b: ['.p..c.Y', 'Y....b.', '..r..G.', 'c..Y..p'],
};

/** Compact thought bubble with n (0-3) dots, 9x4. */
export function bubbleDots(n: number): string[] {
  const mid = ['w', 'w', 'w', 'w', 'w', 'w', 'w', 'w', 'w'];
  [2, 4, 6].forEach((c, i) => { if (i < n) mid[c] = 'u'; });
  return ['.wwwwwww.', mid.join(''), '.wwwwwww.', 'ww.......'];
}

/** Small question/exclamation/Z using the 3x5 font. */
export function glyph(s: string, color: string): string[] { return textRows(s, color); }

export interface PropItem {
  /** prop name in PROPS, or one of: dots, text */
  k: string;
  /** row/column offset of the prop's top-left from the body's top-left */
  dr: number;
  dc: number;
  /** dots: number of dots; text: the string */
  n?: number;
  s?: string;
  color?: string;
}

export function propRows(p: PropItem): string[] {
  if (p.k === 'dots') return bubbleDots(p.n ?? 3);
  if (p.k === 'text') return textRows(p.s ?? '?', p.color ?? 'w');
  const rows = PROPS[p.k];
  if (!rows) throw new Error(`unknown prop ${p.k}`);
  return rows;
}
