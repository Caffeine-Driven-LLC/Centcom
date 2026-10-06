/** 8x8-pixel mini Cento (8 columns x 4 terminal rows) for fleet rows and chips. */
import { recolorRows, type CentoColor } from './palette.js';

export type MiniState = 'idle' | 'working' | 'thinking' | 'waiting' | 'error' | 'done' | 'sleeping';

const LEGS: [string, string][] = [['BB.BB.BB', 'B..B..B.'], ['BB.BB.BB', '.B.BB.B.']];
const EYES: Record<MiniState, [string, string]> = {
  idle: ['BBPBBPBB', 'BBPBBPBB'],
  working: ['BBBBBBBB', 'BPPBBPPB'],
  thinking: ['BBBPBBBP', 'BBBPBBBP'],
  waiting: ['BBBPBBPB', 'BBBBBBBB'],
  error: ['BPBBBBPB', 'BBPBBPBB'],
  done: ['BBPBBPBB', 'BPBBBBPB'],
  sleeping: ['BBBBBBBB', 'BPPBBPPB'],
};
const TIP: Record<MiniState, string> = { idle: 'T', working: 'T', thinking: 'T', waiting: 'Y', error: 'R', done: 'T', sleeping: 'g' };

export function miniRows(state: MiniState, color: CentoColor, frame = 0): string[] {
  const t = TIP[state];
  const legs = LEGS[frame % 2]!;
  const rows = ['...' + t + t + '...', '..BBBB..', '.BBBBBB.', ...EYES[state], 'BBBBBBBB', ...legs].map((r) => r.slice(0, 8));
  rows[0] = '...' + t + t + '...'.slice(0, 3);
  return recolorRows(rows, color);
}
