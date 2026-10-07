/** `--from` and `--to`: an RFC 3339 time or a relative one (`90m`, `24h`, `7d`, `2w`), turned into UTC with milliseconds. */
const UNIT_MS = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 } as const;
export class TimeFilterError extends Error { constructor(input: string) { super(`"${input.slice(0, 40)}" is not a time. Use an RFC 3339 time like 2026-10-01T00:00:00Z, or a relative one like 24h or 7d.`); this.name = 'TimeFilterError'; } }
const RFC = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;
export function parseTimeFilter(input: string, now: Date): string {
  const s = input.trim(); const rel = /^(\d{1,6})([smhdw])$/.exec(s);
  if (rel) return new Date(now.getTime() - Number(rel[1]) * UNIT_MS[rel[2] as keyof typeof UNIT_MS]).toISOString();
  const m = RFC.exec(s); if (!m) throw new TimeFilterError(input);
  const [, y, mo, d, h, mi, se] = m; if (+mo! < 1 || +mo! > 12 || +d! < 1 || +d! > 31 || +h! > 23 || +mi! > 59 || +se! > 60) throw new TimeFilterError(input);
  const t = Date.parse(s.replace(/(\.\d{3})\d+/, '$1')); if (!Number.isFinite(t)) throw new TimeFilterError(input);
  const back = new Date(t); if (m[8] === 'Z' && (back.getUTCDate() !== +d! || back.getUTCMonth() + 1 !== +mo! || String(back.getUTCFullYear()) !== y)) throw new TimeFilterError(input); /* 2026-02-31 */
  return back.toISOString();
}
