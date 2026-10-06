/** Pixel palette: one character = one colour. Same table as assets/mascot (cento_lib.py). */
export const PAL_HEX: Record<string, string> = {
  B: '#7C5CFF', D: '#5A3FD1', H: '#A892FF', S: '#5A3FD1', P: '#1B1530', T: '#3DF2C8', W: '#D9D2FF', R: '#FF5C5C',
  w: '#F2F0FF', g: '#8E88A8', u: '#2E2850', K: '#3A3556', k: '#0A0714', L: '#9FB4FF', G: '#4ADE80', Y: '#FFD166',
  O: '#FF9F43', N: '#8B5E3C', p: '#FF8FB3', b: '#5AA9FF', r: '#FF5C5C', c: '#3DF2C8', v: '#A892FF', q: '#3B2A8C',
  t: '#D9A066', h: '#2F9E5B',
  '1': '#22C55E', '2': '#15803D', '3': '#86EFAC',
  '4': '#FF2D2D', '5': '#B80F0F', '6': '#FF8080',
  '7': '#FFD500', '8': '#C99A00', '9': '#FFEA70',
  '@': '#8B5A2B', '%': '#5C3A1A', '&': '#B5895A',
};

export type CentoColor = 'violet' | 'red' | 'yellow' | 'green' | 'brown';
export const CENTO_COLORS: readonly CentoColor[] = ['violet', 'red', 'yellow', 'green', 'brown'];

/** body, shadow, highlight, stalk characters per colour */
export const PALMAP: Record<CentoColor, { B: string; D: string; H: string; S: string }> = {
  violet: { B: 'B', D: 'D', H: 'H', S: 'S' },
  red: { B: '4', D: '5', H: '6', S: '5' },
  yellow: { B: '7', D: '8', H: '9', S: '8' },
  green: { B: '1', D: '2', H: '3', S: '2' },
  brown: { B: '@', D: '%', H: '&', S: '%' },
};

/** Recolour pixel rows drawn in the default violet to another Cento colour. */
export function recolorRows(rows: readonly string[], color: CentoColor): string[] {
  if (color === 'violet') return [...rows];
  const m = PALMAP[color];
  return rows.map((r) => r.replace(/[BDHS]/g, (ch) => m[ch as 'B' | 'D' | 'H' | 'S']));
}
