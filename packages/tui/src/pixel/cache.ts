/** Rendered mascot frames, drawn once and kept: a frame from the cache costs almost nothing. */
import { ASCII_CENTO, getBaked, recolorBaked, renderHalfBlock, type CentoColor } from '@centcom/mascot';

export type Tier = 'truecolor' | '256' | '16' | 'none';
export type CentoSize = 'hero' | 'mini';
export interface Frame { d: number; lines: string[] }
/** Which text face stands in for an animation when there is no colour or no unicode. */
export function faceFor(animation: string): keyof typeof ASCII_CENTO {
  const a = animation.toLowerCase(); if (/error|crash|panic|glitch|fail|worried|deny|denied/.test(a)) return 'error'; if (/sleep|away|zzz/.test(a)) return 'sleeping'; if (/think|plan|search|read|wait|permission|question/.test(a)) return 'thinking';
  if (/celebrate|happy|success|thumbs|tests_pass|approve|welcome|high_five|merge/.test(a)) return 'happy'; if (/edit|writ|run|work|tool|stream|creat|build|deploy|background/.test(a)) return 'working'; return 'idle';
}
/** `¡` over the face (DESIGN 19.3), with plain-ASCII faces when unicode is off. */
export function asciiCento(animation: string, unicode: boolean): string[] {
  const rows = ASCII_CENTO[faceFor(animation)]!; if (unicode) return [...rows];
  return rows.map((r) => r.replace(/•/g, 'o').replace(/¡/g, '!').replace('⌨', '[kb]'));
}
/** The body of a hero frame boiled down to 6 columns by 2 rows of cells (6 by 4 pixels): each pixel is the busiest letter in its 2x3 block. */
export function miniRows(rows: readonly string[]): string[] {
  const live = rows.map((r) => r.split('')); let top = live.findIndex((r) => r.some((c) => c !== '.')); const lastIdx = live.map((r) => r.some((c) => c !== '.')).lastIndexOf(true); if (top < 0) return ['......', '......', '......', '......'];
  const h = lastIdx - top + 1; const left = Math.min(...live.slice(top, lastIdx + 1).map((r) => { const i = r.findIndex((c) => c !== '.'); return i < 0 ? 99 : i; })); const right = Math.max(...live.slice(top, lastIdx + 1).map((r) => r.map((c, i) => (c !== '.' ? i : -1)).reduce((a, b) => Math.max(a, b), -1)));
  const w = right - left + 1; const out: string[] = [];
  for (let y = 0; y < 4; y++) { let line = ''; for (let x = 0; x < 6; x++) { const y0 = top + Math.floor((y * h) / 4); const y1 = Math.max(y0 + 1, top + Math.floor(((y + 1) * h) / 4)); const x0 = left + Math.floor((x * w) / 6); const x1 = Math.max(x0 + 1, left + Math.floor(((x + 1) * w) / 6)); const count = new Map<string, number>(); for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { const c = live[yy]?.[xx] ?? '.'; count.set(c, (count.get(c) ?? 0) + 1); } let best = '.'; let n = 0; for (const [c, k] of count) if (c !== '.' && k >= n) { best = c; n = k; } const total = (y1 - y0) * (x1 - x0); line += n * 2 >= total ? best : '.'; } out.push(line); }
  return out;
}
export interface FrameCache { frames(animation: string, color: CentoColor, tier: Tier, size: CentoSize, unicode: boolean): Frame[]; lines(animation: string, frame: number, color: CentoColor, tier: Tier, size?: CentoSize, unicode?: boolean): string[]; size(): number }
export function createFrameCache(loader: (name: string) => ReturnType<typeof getBaked> = getBaked): FrameCache {
  const cache = new Map<string, Frame[]>();
  const frames: FrameCache['frames'] = (animation, color, tier, size, unicode) => {
    const key = `${animation}|${color}|${tier}|${size}|${unicode}`; const hit = cache.get(key); if (hit) return hit;
    const a = loader(animation) ?? loader('idle_breathe'); let out: Frame[];
    if (!a || tier === '16' || tier === 'none' || !unicode) out = [{ d: 500, lines: asciiCento(animation, unicode) }]; /* no colour, no unicode: a text face, one frame */
    else { const r = recolorBaked(a, color); out = r.frames.map((f) => ({ d: Math.min(500, Math.max(80, f.d)), lines: renderHalfBlock(size === 'mini' ? miniRows(f.rows) : f.rows, tier) })); }
    cache.set(key, out); return out;
  };
  return { frames, lines: (an, i, c, t, s = 'hero', u = true) => { const f = frames(an, c, t, s, u); return f[((i % f.length) + f.length) % f.length]!.lines; }, size: () => cache.size };
}
