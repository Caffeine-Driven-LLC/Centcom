/** What this terminal can do, decided once at startup from the environment and the two streams (a pure function: no process.env here). */
export type ColorTier = 'truecolor' | '256' | '16' | 'none';
export interface TermCaps {
  tier: ColorTier; unicode: boolean; isTTY: boolean; cols: number; rows: number; halfBlock: boolean; hyperlinks: boolean; bracketedPaste: boolean;
  mascotEnv: 'on' | 'off' | 'auto'; reduceMotionEnv: boolean; spinnerEnv: 'fun' | 'plain' | 'auto'; themeEnv: 'dark' | 'light' | 'auto';
  /** Env values that were not understood (and ignored). Never thrown. */
  warnings: string[];
}
type Out = { isTTY?: boolean; columns?: number; rows?: number }; type Inp = { isTTY?: boolean };

/** `NO_COLOR` set to anything but empty wins over every other signal. */
function tierOf(env: NodeJS.ProcessEnv, tty: boolean): ColorTier {
  if (env.NO_COLOR) return 'none'; if (!tty || env.TERM === 'dumb') return 'none';
  if (/^(truecolor|24bit)$/i.test(env.COLORTERM ?? '')) return 'truecolor';
  if (/256color/i.test(env.TERM ?? '')) return '256'; return '16';
}
const utf8 = (env: NodeJS.ProcessEnv) => { if (env.TERM === 'linux') return false; const l = env.LC_ALL || env.LC_CTYPE || env.LANG || ''; return /utf-?8/i.test(l); };
function pick<T extends string>(name: string, v: string | undefined, ok: readonly T[], fallback: T, warnings: string[]): T {
  if (v === undefined || v === '') return fallback; const x = v.toLowerCase() as T; if (ok.includes(x)) return x; warnings.push(`${name}=${v} is not one of ${ok.join(', ')}; using ${fallback}.`); return fallback;
}

export function detectCapabilities(env: NodeJS.ProcessEnv, out: Out, inp?: Inp): TermCaps {
  const warnings: string[] = []; const isTTY = !!out.isTTY && inp?.isTTY !== false; const tier = tierOf(env, !!out.isTTY); const unicode = utf8(env);
  const mascotEnv = pick('CENTO_MASCOT', env.CENTO_MASCOT, ['on', 'off'] as const, 'auto' as 'on' | 'off' | 'auto', warnings);
  const spinnerEnv = pick('CENTO_SPINNER', env.CENTO_SPINNER, ['fun', 'plain'] as const, 'auto' as 'fun' | 'plain' | 'auto', warnings);
  const themeEnv = pick('CENTO_THEME', env.CENTO_THEME, ['dark', 'light', 'auto'] as const, 'auto', warnings);
  let reduceMotionEnv = false; if (env.CENTO_REDUCE_MOTION !== undefined && env.CENTO_REDUCE_MOTION !== '') { if (/^(1|true|on|yes)$/i.test(env.CENTO_REDUCE_MOTION)) reduceMotionEnv = true; else if (!/^(0|false|off|no)$/i.test(env.CENTO_REDUCE_MOTION)) warnings.push(`CENTO_REDUCE_MOTION=${env.CENTO_REDUCE_MOTION} is not 1 or 0; ignored.`); }
  return Object.freeze({ tier, unicode, isTTY, cols: out.columns ?? 80, rows: out.rows ?? 24, halfBlock: unicode && tier !== 'none', hyperlinks: isTTY && tier !== 'none' && env.TERM !== 'linux' && !/^(dumb|screen)$/.test(env.TERM ?? ''), bracketedPaste: isTTY && env.TERM !== 'dumb' && env.TERM !== 'linux', mascotEnv, reduceMotionEnv, spinnerEnv, themeEnv, warnings });
}

export type LayoutClass = 'ok' | 'narrow' | 'short' | 'tiny';
/** `tiny` first (under 40 columns or 10 rows), then narrow (under 80 columns), then short (under 24 rows). */
export function layoutClass(cols: number, rows: number): LayoutClass { if (cols < 40 || rows < 10) return 'tiny'; if (cols < 80) return 'narrow'; if (rows < 24) return 'short'; return 'ok'; }
/** DESIGN 10.1.9: at least 80 columns and 30 rows, and the person has not turned the mascot off. */
export function mascotAllowed(c: Pick<TermCaps, 'cols' | 'rows' | 'mascotEnv'>): boolean { return c.mascotEnv !== 'off' && c.cols >= 80 && c.rows >= 30; }
