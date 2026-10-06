/**
 * Terminal colour capability detection and conversion (lane C031 / C032).
 * Owns: deciding how many colours the terminal can show and converting a hex colour to the nearest
 * representable one. Must not: read the terminal asynchronously or write to stdout.
 */
export type ColorTier = 'truecolor' | '256' | '16' | 'none';

export interface TierEnv {
  env: Record<string, string | undefined>;
  isTTY: boolean;
  /** CLI flag override such as --color=never|always|16|256|truecolor */
  flag?: string;
}

/** Decide the colour tier. NO_COLOR and non-TTY output win; then flags; then COLORTERM/TERM. */
export function detectColorTier({ env, isTTY, flag }: TierEnv): ColorTier {
  if (flag === 'never') return 'none';
  if (flag === 'truecolor' || flag === '256' || flag === '16') return flag;
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== '') return 'none';
  if (!isTTY && flag !== 'always') return 'none';
  if (env.TERM === 'dumb') return 'none';
  const ct = (env.COLORTERM ?? '').toLowerCase();
  if (ct === 'truecolor' || ct === '24bit') return 'truecolor';
  if (env.TERM_PROGRAM === 'iTerm.app' || env.TERM_PROGRAM === 'vscode' || env.WT_SESSION) return 'truecolor';
  const term = env.TERM ?? '';
  if (/(kitty|alacritty|wezterm|ghostty|foot|direct)/.test(term)) return 'truecolor';
  if (/256/.test(term)) return '256';
  if (term === '' || term === 'linux' || term === 'vt100') return '16';
  return '16';
}

export type RGB = readonly [number, number, number];

export function hexToRgb(hex: string): RGB {
  const h = hex.replace('#', '');
  const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)];
}

export function rgbToHex([r, g, b]: RGB): string {
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
}

const CUBE: readonly number[] = [0, 95, 135, 175, 215, 255];

function dist(a: RGB, b: RGB): number {
  const dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2];
  // redmean weighting: closer to perceived difference than plain euclid
  const rm = (a[0] + b[0]) / 2;
  return (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db;
}

/** Nearest xterm-256 index (16..255: 6x6x6 cube or the 24-step grey ramp). */
export function nearest256(rgb: RGB): number {
  let best = 16, bestD = Infinity;
  const consider = (idx: number, c: RGB) => { const d = dist(rgb, c); if (d < bestD) { bestD = d; best = idx; } };
  const q = (v: number) => CUBE.reduce((bi, c, i) => (Math.abs(c - v) < Math.abs(CUBE[bi]! - v) ? i : bi), 0);
  const r = q(rgb[0]), g = q(rgb[1]), b = q(rgb[2]);
  consider(16 + 36 * r + 6 * g + b, [CUBE[r]!, CUBE[g]!, CUBE[b]!]);
  for (let i = 0; i < 24; i++) { const v = 8 + 10 * i; consider(232 + i, [v, v, v]); }
  return best;
}

/** The 16 ANSI colours as most terminals draw them; used only to pick the nearest slot. */
const ANSI16: readonly RGB[] = [
  [0, 0, 0], [205, 49, 49], [13, 188, 121], [229, 229, 16], [36, 114, 200], [188, 63, 188], [17, 168, 205], [229, 229, 229],
  [102, 102, 102], [241, 76, 76], [35, 209, 139], [245, 245, 67], [59, 142, 234], [214, 112, 214], [41, 184, 219], [255, 255, 255],
];

/** Nearest ANSI-16 slot 0..15. */
export function nearest16(rgb: RGB): number {
  let best = 0, bestD = Infinity;
  ANSI16.forEach((c, i) => { const d = dist(rgb, c); if (d < bestD) { bestD = d; best = i; } });
  return best;
}

/** SGR parameter string for a foreground (kind 'fg') or background colour at the given tier; '' when none. */
export function sgr(hex: string, tier: ColorTier, kind: 'fg' | 'bg'): string {
  if (tier === 'none') return '';
  const rgb = hexToRgb(hex);
  const base = kind === 'fg' ? 38 : 48;
  if (tier === 'truecolor') return `${base};2;${rgb[0]};${rgb[1]};${rgb[2]}`;
  if (tier === '256') return `${base};5;${nearest256(rgb)}`;
  const i = nearest16(rgb);
  const off = kind === 'fg' ? 30 : 40;
  return i < 8 ? String(off + i) : String(off + 60 + (i - 8));
}

/** The colour as Ink should be told about it: Ink/chalk downgrades hex itself, so only 'none' returns undefined. */
export function inkColor(hex: string | undefined, tier: ColorTier): string | undefined {
  return tier === 'none' ? undefined : hex;
}
