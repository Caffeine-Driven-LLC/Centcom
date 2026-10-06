/**
 * IP bans for repeated pairing failures (CT-LAN §2: too many tries ban the source IP for 10 minutes).
 * Owns: counting failures per source address in a sliding window and the ban expiry, on a monotonic clock. Bounded: at most 4 096 tracked addresses.
 * Must not: ban on a disconnect alone (only confirmed wrong codes are reported here).
 */
import { mono, type LanClock } from '../clock.js';

/** What the LAN host server (lane C072) checks at accept time. */
export interface BanList { isBanned(ip: string): boolean }
/** What pairing fills. */
export interface MutableBanList extends BanList { recordFailure(ip: string): boolean; ban(ip: string, ms?: number): void; unban(ip: string): void }

export const BAN_MS = 10 * 60_000;
export const BAN_AFTER_FAILURES = 5;
export const FAILURE_WINDOW_MS = 10 * 60_000;
const MAX_TRACKED = 4096;

export class MemoryBanList implements MutableBanList {
  private failures = new Map<string, number[]>(); private bans = new Map<string, number>();
  constructor(private clock: LanClock, private o: { banMs?: number; threshold?: number; windowMs?: number } = {}) {}

  isBanned(ip: string): boolean { const until = this.bans.get(norm(ip)); if (until === undefined) return false; if (mono(this.clock) > until) { this.bans.delete(norm(ip)); return false; } return true; }

  /** Count one failure; bans the address (and returns true) once it reaches the threshold inside the window. */
  recordFailure(ip: string): boolean {
    const k = norm(ip); const now = mono(this.clock); const win = this.o.windowMs ?? FAILURE_WINDOW_MS;
    const list = (this.failures.get(k) ?? []).filter((t) => now - t < win); list.push(now);
    if (!this.failures.has(k) && this.failures.size >= MAX_TRACKED) this.prune(now, win);
    this.failures.set(k, list.slice(-32));
    if (list.length >= (this.o.threshold ?? BAN_AFTER_FAILURES)) { this.ban(k); this.failures.delete(k); return true; }
    return false;
  }

  ban(ip: string, ms = this.o.banMs ?? BAN_MS): void { if (this.bans.size >= MAX_TRACKED) this.prune(mono(this.clock), 0); this.bans.set(norm(ip), mono(this.clock) + ms); }
  unban(ip: string): void { this.bans.delete(norm(ip)); this.failures.delete(norm(ip)); }

  private prune(now: number, win: number) {
    for (const [k, l] of this.failures) if (!l.some((t) => now - t < win)) this.failures.delete(k);
    for (const [k, until] of this.bans) if (now > until) this.bans.delete(k);
    while (this.failures.size >= MAX_TRACKED) { const first = this.failures.keys().next().value; if (first === undefined) break; this.failures.delete(first); }
  }
}

/** IPv4-mapped IPv6 (::ffff:1.2.3.4) and the plain form count as one address. */
const norm = (ip: string) => ip.toLowerCase().replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/, '');
