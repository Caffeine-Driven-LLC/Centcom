/**
 * Cento sprite builder: face, arms, legs and accessories on a 12x12 body grid.
 * A faithful TypeScript port of cento_pixels() from assets/mascot/cento_lib.py. Pure: no I/O, no clock.
 */
import { PALMAP, type CentoColor } from './palette.js';

export type Pixels = Map<string, string>; // "r,c" -> palette char
const key = (r: number, c: number) => `${r},${c}`;

export type EyeState =
  | 'open' | 'closed' | 'happy' | 'ring' | 'left' | 'right' | 'up' | 'down' | 'x' | 'squint' | 'dot'
  | 'heart' | 'star' | 'dz1' | 'dz2' | 'shine' | 'tear' | 'angry' | 'sad' | 'none';
export type MouthState = 'flat' | 'smile' | 'grin' | 'open' | 'gasp' | 'frown' | 'zig' | 'small' | 'none' | 'tongue';
export type ArmState = 'down' | 'side' | 'out' | 'far' | 'up' | 'upw' | 'high' | 'flex' | 'cheer' | 'dn' | 'reach' | 'hand' | 'hand2' | 'cover';
export type LegState = 'a' | 'b' | 'tuck' | 'wide';
export type Accessory = 'headphones' | 'sunglasses' | 'glasses' | 'party' | 'cap' | 'crown' | 'wizard' | 'headband' | 'mask' | 'cape' | 'blush' | 'sweat';

export interface CentoSpec {
  e?: EyeState | readonly [EyeState, EyeState];
  m?: MouthState;
  al?: ArmState;
  ar?: ArmState;
  lg?: LegState;
  acc?: readonly Accessory[];
  /** antenna tip palette char: 'T' mint (default), 'R' red, 'Y' yellow, 'g' dim */
  tip?: string;
  color?: CentoColor;
  /** quarter turns clockwise */
  rot?: 0 | 1 | 2 | 3;
}

const HEAD = [
  '............', '............', '..BBBBBBBB..', '.HBBBBBBBBB.', '.BBBBBBBBBB.',
  'BBBBBBBBBBBB', 'BBBBBBBBBBBB', 'BBBBBBBBBBBB', 'BBBBBBBBBBBB', 'DBBBBBBBBBBD',
];
const LEGS: Record<LegState, [string, string]> = {
  a: ['BB.BB..BB.BB', 'B.BB....BB.B'],
  b: ['BB.BB..BB.BB', '.B.BB..BB.B.'],
  tuck: ['BB.BBBBBB.BB', '.B........B.'],
  wide: ['B.BB.BB.BB.B', 'B..B....B..B'],
};

type Px = [number, number, string];

function eyePixels(state: EyeState, side: 'l' | 'r'): Px[] {
  const b = side === 'l' ? 2 : 7;
  const L = side === 'l';
  const P = 'P';
  switch (state) {
    case 'open': return [[6, b + 1, P], [7, b + 1, P]];
    case 'closed': return [[7, b, P], [7, b + 1, P], [7, b + 2, P]];
    case 'happy': return [[6, b + 1, P], [7, b, P], [7, b + 2, P]];
    case 'ring': return [[5, b, P], [5, b + 1, P], [5, b + 2, P], [6, b, P], [6, b + 2, P], [7, b, P], [7, b + 1, P], [7, b + 2, P]];
    case 'left': return [[6, b, P], [7, b, P]];
    case 'right': return [[6, b + 2, P], [7, b + 2, P]];
    case 'up': return [[5, b + 1, P], [6, b + 1, P]];
    case 'down': return [[7, b + 1, P], [8, b + 1, P]];
    case 'x': return [[5, b, P], [5, b + 2, P], [6, b + 1, P], [7, b, P], [7, b + 2, P]];
    case 'squint': return L ? [[7, b, P], [7, b + 1, P]] : [[7, b + 1, P], [7, b + 2, P]];
    case 'dot': return [[7, b + 1, P]];
    case 'heart': return [[5, b, 'p'], [5, b + 2, 'p'], [6, b, 'p'], [6, b + 1, 'p'], [6, b + 2, 'p'], [7, b + 1, 'p']];
    case 'star': return [[5, b + 1, 'Y'], [6, b, 'Y'], [6, b + 1, 'Y'], [6, b + 2, 'Y'], [7, b + 1, 'Y']];
    case 'dz1': return [[5, b, P], [5, b + 1, P], [6, b + 2, P], [7, b + 1, P], [7, b, P]];
    case 'dz2': return [[5, b + 1, P], [5, b + 2, P], [6, b, P], [7, b + 1, P], [7, b + 2, P]];
    case 'shine': return [[6, b + 1, 'w'], [7, b + 1, P]];
    case 'tear': return [[6, b + 1, P], [7, b + 1, P], [8, b + 1, 'b'], [9, b + 1, 'b']];
    case 'angry': return [[6, b + 1, P], [7, b + 1, P], ...(L ? [[5, b + 1, P], [5, b + 2, P], [4, b, P]] : [[5, b, P], [5, b + 1, P], [4, b + 2, P]]) as Px[]];
    case 'sad': return [[6, b + 1, P], [7, b + 1, P], ...(L ? [[5, b, P], [5, b + 1, P], [4, b + 2, P]] : [[5, b + 1, P], [5, b + 2, P], [4, b, P]]) as Px[]];
    case 'none': return [];
  }
}

const MOUTHS: Record<MouthState, [number, number][]> = {
  flat: [[8, 5], [8, 6]],
  smile: [[8, 4], [8, 7], [9, 5], [9, 6]],
  grin: [[8, 4], [8, 5], [8, 6], [8, 7], [9, 5], [9, 6]],
  open: [[8, 5], [8, 6], [9, 5], [9, 6]],
  gasp: [[8, 4], [8, 5], [8, 6], [8, 7], [9, 4], [9, 5], [9, 6], [9, 7]],
  frown: [[8, 5], [8, 6], [9, 4], [9, 7]],
  zig: [[8, 4], [9, 5], [8, 6], [9, 7]],
  small: [[8, 5]],
  none: [],
  tongue: [[8, 4], [8, 5], [8, 6], [8, 7]],
};

const ARMS: Record<ArmState, [number, number][]> = {
  down: [],
  side: [[8, -1], [9, -1], [10, -1]],
  out: [[8, -1], [8, -2]],
  far: [[8, -1], [8, -2], [8, -3]],
  up: [[8, -1], [7, -1], [6, -1], [5, -1]],
  upw: [[8, -1], [7, -1], [6, -1], [5, -2]],
  high: [[8, -1], [7, -1], [6, -1], [5, -1], [4, -1], [3, -1]],
  flex: [[8, -1], [7, -1], [7, -2], [6, -2]],
  cheer: [[8, -1], [7, -2], [6, -3], [5, -3]],
  dn: [[8, -1], [9, -2], [10, -3]],
  reach: [[8, -1], [7, -1], [6, -1], [5, -1], [4, -1], [3, -1], [2, -1], [2, -2], [2, -3], [2, -4], [2, -5], [2, -6]],
  hand: [[9, 3], [9, 4]],
  hand2: [[8, 3], [8, 4]],
  cover: [[6, 2], [6, 3], [6, 4], [7, 2], [7, 3], [7, 4]],
};
const HAND_ONLY = new Set<ArmState>(['hand', 'hand2', 'cover']);

const ACC: Record<Accessory, Px[]> = {
  headphones: [[3, 0, 'u'], [2, 1, 'u'], [1, 2, 'u'], [1, 3, 'u'], [1, 4, 'u'], [1, 7, 'u'], [1, 8, 'u'], [1, 9, 'u'], [2, 10, 'u'], [3, 11, 'u'],
    [4, -1, 'K'], [5, -1, 'K'], [6, -1, 'K'], [4, 0, 'K'], [5, 0, 'K'], [6, 0, 'K'], [4, 12, 'K'], [5, 12, 'K'], [6, 12, 'K'], [4, 11, 'K'], [5, 11, 'K'], [6, 11, 'K']],
  sunglasses: [...[1, 2, 3, 4, 7, 8, 9, 10].map((c): Px => [6, c, 'k']), ...[2, 3, 4, 7, 8, 9].map((c): Px => [7, c, 'k']), [6, 5, 'k'], [6, 6, 'k'], [6, 2, 'w']],
  glasses: [[5, 2, 'w'], [5, 3, 'w'], [5, 4, 'w'], [6, 2, 'w'], [6, 4, 'w'], [7, 2, 'w'], [7, 3, 'w'], [7, 4, 'w'],
    [5, 7, 'w'], [5, 8, 'w'], [5, 9, 'w'], [6, 7, 'w'], [6, 9, 'w'], [7, 7, 'w'], [7, 8, 'w'], [7, 9, 'w'], [6, 5, 'w'], [6, 6, 'w']],
  party: [[-1, 5, 'p'], [-1, 6, 'p'], [0, 5, 'Y'], [0, 6, 'Y'], [1, 4, 'O'], [1, 5, 'Y'], [1, 6, 'O'], [1, 7, 'Y'], [2, 3, 'Y'], [2, 4, 'O'], [2, 5, 'Y'], [2, 6, 'O'], [2, 7, 'Y'], [2, 8, 'O']],
  cap: [...[2, 3, 4, 5, 6, 7, 8, 9].map((c): Px => [2, c, 'b']), ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].map((c): Px => [3, c, 'b'])],
  crown: [[0, 3, 'Y'], [0, 5, 'Y'], [0, 6, 'Y'], [0, 8, 'Y'], ...[3, 4, 5, 6, 7, 8].map((c): Px => [1, c, 'Y']), [1, 5, 'r'], [2, 3, 'Y'], [2, 4, 'Y'], [2, 7, 'Y'], [2, 8, 'Y']],
  wizard: [[-3, 6, 'q'], [-2, 5, 'q'], [-2, 6, 'q'], [-1, 4, 'q'], [-1, 5, 'Y'], [-1, 6, 'q'], [-1, 7, 'q'], ...[3, 4, 5, 6, 7, 8].map((c): Px => [0, c, 'q']), ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((c): Px => [1, c, 'q'])],
  headband: [...Array.from({ length: 12 }, (_, c): Px => [5, c, 'r']), [5, 12, 'r'], [6, 13, 'r'], [4, 13, 'r']],
  mask: [...Array.from({ length: 12 }, (_, c): Px => [6, c, 'k']), ...[1, 2, 3, 4, 7, 8, 9, 10].flatMap((c): Px[] => [[7, c, 'k'], [5, c, 'k']])],
  cape: [...Array.from({ length: 8 }, (_, i): Px[] => [[4 + i, -1, 'r'], [4 + i, 12, 'r']]).flat(), ...Array.from({ length: 5 }, (_, i): Px[] => [[7 + i, -2, 'r'], [7 + i, 13, 'r']]).flat()],
  blush: [[8, 2, 'p'], [8, 9, 'p']],
  sweat: [[3, 11, 'b'], [4, 12, 'b'], [5, 12, 'b']],
};

/** Build one Cento on a sparse grid (negative coordinates are arms and accessories). */
export function centoPixels(spec: CentoSpec = {}): Pixels {
  const g: Pixels = new Map();
  const color = spec.color ?? 'violet';
  const set = (r: number, c: number, ch: string) => g.set(key(r, c), ch);
  const legs = LEGS[spec.lg ?? 'a'];
  [...HEAD, ...legs].forEach((row, r) => [...row].forEach((ch, c) => { if (ch !== '.') set(r, c, ch); }));
  const tip = spec.tip ?? 'T';
  set(0, 5, tip); set(0, 6, tip); set(1, 5, 'S'); set(1, 6, 'S');
  const [el, er] = Array.isArray(spec.e) ? spec.e : [spec.e ?? 'open', spec.e ?? 'open'] as [EyeState, EyeState];
  for (const [r, c, ch] of [...eyePixels(el, 'l'), ...eyePixels(er, 'r')]) set(r, c, ch);
  for (const [r, c] of MOUTHS[spec.m ?? 'flat']) set(r, c, 'P');
  if (spec.m === 'tongue') { set(9, 5, 'p'); set(9, 6, 'p'); }
  for (const [side, a] of [['l', spec.al ?? 'down'], ['r', spec.ar ?? 'down']] as const) {
    const pts = ARMS[a];
    pts.forEach(([r, c], i) => set(r, side === 'l' ? c : 11 - c, HAND_ONLY.has(a) || i === pts.length - 1 ? 'D' : 'B'));
  }
  for (const a of spec.acc ?? []) for (const [r, c, ch] of ACC[a]) set(r, c, ch);
  const pm = PALMAP[color];
  let out: Pixels = new Map();
  for (const [k, ch] of g) out.set(k, 'BDHS'.includes(ch) ? pm[ch as 'B' | 'D' | 'H' | 'S'] : ch);
  for (let i = 0; i < (spec.rot ?? 0); i++) {
    const rotated: Pixels = new Map();
    for (const [k, ch] of out) { const [r, c] = k.split(',').map(Number) as [number, number]; rotated.set(key(c, 11 - r), ch); }
    out = rotated;
  }
  return out;
}

export { key as pixelKey };
