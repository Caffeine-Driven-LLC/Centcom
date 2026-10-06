/**
 * Chooses which scene Cento plays for the agent's product state, with the rules from the design system:
 * minimum dwell (no flicker), one-shot scenes that return to the previous state, error/approval take priority,
 * night-time sleeping, and a static frame under reduced motion (lanes C046, C049).
 */
import { SCENES, SCENE_FOR_STATE, renderScene } from './scenes.js';
import type { CentoColor } from './palette.js';

export interface Clock { now(): number; setTimeout(fn: () => void, ms: number): unknown; clearTimeout(h: unknown): void }
export const realClock: Clock = { now: () => Date.now(), setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (h) => clearTimeout(h as NodeJS.Timeout) };

export interface MascotFrame { scene: string; state: string; index: number; rows: string[]; width: number; height: number }

const URGENT = new Set(['error', 'crash', 'awaiting-approval', 'asking-question', 'provider-auth-required', 'provider-cap-reached']);

export interface DriverOptions { clock?: Clock; reducedMotion?: boolean; dwellMs?: number; color?: CentoColor; sleepAfterMs?: number }

export class MascotDriver {
  private clock: Clock;
  private reduced: boolean;
  private dwell: number;
  private color: CentoColor;
  private sleepAfter: number;
  private state = 'idle';           // the state we are showing
  private base = 'idle';            // the state to return to after a one-shot
  private pending?: string;         // latest requested state waiting out the dwell
  private since = -Infinity;     // the initial idle has no dwell: the first real state applies at once
  private idleSince: number;
  private index = 0;
  private timer: unknown;
  private dwellTimer: unknown;
  private listeners = new Set<(f: MascotFrame) => void>();

  constructor(o: DriverOptions = {}) {
    this.clock = o.clock ?? realClock;
    this.reduced = o.reducedMotion ?? false;
    this.dwell = o.dwellMs ?? 600;
    this.color = o.color ?? 'violet';
    this.sleepAfter = o.sleepAfterMs ?? 10 * 60_000;
    this.idleSince = this.clock.now();
  }

  get frame(): MascotFrame {
    const name = this.sceneName();
    const r = renderScene(name, this.color);
    const i = this.reduced ? 0 : Math.min(this.index, r.frames.length - 1);
    return { scene: name, state: this.state, index: i, rows: r.frames[i]!.rows, width: r.width, height: r.height };
  }

  private sceneName(): string {
    if ((this.state === 'idle' || this.state === 'ready') && this.clock.now() - this.idleSince >= this.sleepAfter) return 'sleeping';
    return SCENE_FOR_STATE[this.state] ?? 'thinking'; // unknown states show generic "working" (contract rule)
  }

  subscribe(cb: (f: MascotFrame) => void): () => void { this.listeners.add(cb); return () => this.listeners.delete(cb); }
  private emit() { const f = this.frame; for (const l of this.listeners) l(f); }

  setColor(c: CentoColor) { this.color = c; this.emit(); }
  setReducedMotion(v: boolean) { this.reduced = v; this.restartTimer(); this.emit(); }

  /** Request a product state. Urgent states apply immediately; others wait out the minimum dwell. */
  setState(next: string) {
    if (next === this.state && !this.pending) return;
    if (next === 'idle' || next === 'ready') this.idleSince = this.clock.now();
    const age = this.clock.now() - this.since;
    if (URGENT.has(next) || age >= this.dwell) { this.apply(next); return; }
    this.pending = next;
    if (this.dwellTimer) this.clock.clearTimeout(this.dwellTimer);
    this.dwellTimer = this.clock.setTimeout(() => { const p = this.pending; this.pending = undefined; if (p) this.apply(p); }, this.dwell - age);
  }

  private apply(next: string) {
    this.pending = undefined;
    const scene = SCENES[SCENE_FOR_STATE[next] ?? 'thinking'];
    if (scene?.once) { if (!SCENES[SCENE_FOR_STATE[this.state] ?? '']?.once) this.base = this.state; }
    else this.base = next;
    this.state = next; this.since = this.clock.now(); this.index = 0;
    this.restartTimer(); this.emit();
  }

  private restartTimer() {
    if (this.timer) this.clock.clearTimeout(this.timer);
    this.timer = undefined;
    if (this.reduced) return;
    this.schedule();
  }

  private schedule() {
    const name = this.sceneName();
    const r = renderScene(name, this.color);
    const ms = r.frames[Math.min(this.index, r.frames.length - 1)]!.ms;
    this.timer = this.clock.setTimeout(() => {
      const scene = SCENES[name]!;
      if (this.index + 1 >= r.frames.length) {
        if (scene.once) { this.apply(this.base === this.state ? 'idle' : this.base); return; }
        this.index = 0;
      } else this.index += 1;
      this.emit(); this.schedule();
    }, ms);
  }

  start() { this.restartTimer(); this.emit(); }
  stop() { if (this.timer) this.clock.clearTimeout(this.timer); if (this.dwellTimer) this.clock.clearTimeout(this.dwellTimer); this.timer = this.dwellTimer = undefined; }
}
