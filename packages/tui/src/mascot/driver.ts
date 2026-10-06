/** What the mascot does, decided from product state: priority, dwell, bursts, idle timers, one-shots and when it may be seen.
 *  State drives the mascot; nothing here changes agent state. Time is injected. */
import { knownState, priorityOf, SHOWN_STATES } from './priority.js';

export type CentoColourName = 'violet' | 'red' | 'yellow' | 'green' | 'brown';
export type MascotInput =
  | { type: 'state'; agentId: string; state: string }
  | { type: 'clear'; agentId: string; state: string }
  | { type: 'tool-call'; agentId?: string }
  | { type: 'milestone'; agentId?: string; kind: 'first-commit' | 'pr-merged' | 'release' }
  | { type: 'failure'; agentId?: string; retry?: boolean }
  | { type: 'activity'; agentId?: string };
export interface MascotView { animation: string; loop: boolean; color: CentoColourName; visible: boolean; reason: 'state' | 'idle-timer' | 'one-shot' | 'night' | 'suppressed' | 'off' }
export interface MascotDriver { input(i: MascotInput): void; view(agentId: string): MascotView; chips(agentId: string): string[]; setSuppressed(reason: string, on: boolean): void; /** Forces it on screen (the `/mascot` command). */ show(agentId: string, on: boolean): void; subscribe(fn: (agentId: string, v: MascotView) => void): () => void }
export interface DriverDeps {
  clock: { now(): number; setTimeout(f: () => void, ms: number): unknown; clearTimeout(h: unknown): void }; stateMap: Record<string, string>; rng?: () => number; tz?: () => { hour: number };
  caps: () => { cols: number; rows: number; mascotEnv: 'on' | 'off' | 'auto' }; settings: () => { mascot: 'on' | 'off'; color: CentoColourName; motion: 'full' | 'reduced' }; log?: { debug(m: string): void };
}
export const DWELL_MS = 600; export const BURST_CALLS = 3; export const BURST_WINDOW_MS = 2000; export const BEAT_MS = 200; export const CELEBRATE_GAP_MS = 10 * 60_000; export const WAIT_VISIBLE_MS = 8000; export const ONE_SHOT_MS = 1500;
const IDLE = [[10 * 60_000, 'status_away'], [3 * 60_000, 'look_around'], [20_000, 'idle_blink']] as const;
const FORBIDDEN_REDUCED = new Set(['crash', 'glitch', 'panic']);
interface Agent { active: Map<string, number>; calls: number[]; lastCall: number; shown: { animation: string; since: number; loop: boolean }; idleSince: number; shownByForce: boolean; oneShot?: { animation: string; until: number }; failures: number; lastBeat?: number; workSince?: number; lastTarget?: string }

export function createMascotDriver(d: DriverDeps): MascotDriver {
  const agents = new Map<string, Agent>(); const suppressed = new Set<string>(); const subs = new Set<(id: string, v: MascotView) => void>(); const unknown = new Set<string>(); let lastCelebrate = -Infinity; const timers = new Map<string, unknown>();
  const now = () => d.clock.now();
  const get = (id: string): Agent => { let a = agents.get(id); if (!a) { a = { active: new Map(), calls: [], lastCall: -Infinity, shown: { animation: 'idle_breathe', since: -Infinity, loop: true }, idleSince: now(), shownByForce: false, failures: 0 }; agents.set(id, a); } return a; };
  const animationFor = (state: string): string => { const a = d.stateMap[state]; if (a) return a; if (!unknown.has(state)) { unknown.add(state); d.log?.debug('mascot.unknown_state'); } return 'thinking'; };
  const top = (a: Agent): string | undefined => { let best: string | undefined; let bt = 99; let bs = -1; for (const [s, at] of a.active) { const t = priorityOf(s); if (t < bt || (t === bt && at >= bs)) { best = s; bt = t; bs = at; } } return best; };
  /** The animation that should be showing now, and why. */
  function desired(a: Agent, t: number): { animation: string; loop: boolean; reason: MascotView['reason'] } {
    if (a.oneShot && t < a.oneShot.until) return { animation: a.oneShot.animation, loop: false, reason: 'one-shot' };
    if (a.calls.length > BURST_CALLS && t - a.lastCall <= BURST_WINDOW_MS) return { animation: 'tool_running', loop: true, reason: 'state' };
    const s = top(a); if (s && s !== 'idle' && s !== 'ready') return { animation: animationFor(s), loop: true, reason: 'state' };
    const idle = t - a.idleSince; const h = d.tz?.().hour ?? new Date(t).getHours(); const night = h >= 23 || h < 6;
    if (night && idle >= 30 * 60_000) return { animation: 'sleeping', loop: true, reason: 'night' };
    for (const [ms, an] of IDLE) if (idle >= ms) return { animation: an, loop: true, reason: 'idle-timer' };
    return { animation: animationFor(s ?? 'idle'), loop: true, reason: 'state' };
  }
  const reduce = (an: string): { animation: string; loop?: boolean } => (d.settings().motion === 'reduced' && FORBIDDEN_REDUCED.has(an) ? { animation: 'error', loop: false } : { animation: an });
  function settle(id: string): MascotView {
    const a = get(id); const t = now(); const want = desired(a, t); const r = reduce(want.animation); const animation = r.animation; const loop = r.loop ?? want.loop;
    if (animation !== a.shown.animation) {
      if (want.reason === 'one-shot' || t - a.shown.since >= DWELL_MS || (a.shown.animation === 'prompt_received' && t - a.shown.since >= BEAT_MS)) { /* entering work from idle gets one short beat of acknowledgement */ const wasIdle = a.shown.animation.startsWith('idle') || a.shown.animation === 'sleeping' || a.shown.animation === 'look_around' || a.shown.animation === 'status_away'; if (wasIdle && want.reason === 'state' && priorityOf(top(a) ?? 'idle') === 4 && a.lastBeat === undefined) { a.lastBeat = t; a.shown = { animation: 'prompt_received', since: t, loop: false }; schedule(id, BEAT_MS); } else { a.shown = { animation, since: t, loop }; a.lastBeat = undefined; } }
      else schedule(id, DWELL_MS - (t - a.shown.since));
    } else a.shown.loop = loop;
    const caps = d.caps(); const set = d.settings(); const allowed = caps.mascotEnv !== 'off' && caps.cols >= 80 && caps.rows >= 30;
    const state = top(a); const waitMs = a.workSince !== undefined ? t - a.workSince : 0; const moment = !!a.oneShot && t < a.oneShot.until;
    let visible = allowed && set.mascot !== 'off' && !suppressed.size && (moment || waitMs >= WAIT_VISIBLE_MS || a.shownByForce || (!!state && SHOWN_STATES.has(state)));
    const reason: MascotView['reason'] = set.mascot === 'off' || caps.mascotEnv === 'off' ? 'off' : suppressed.size ? 'suppressed' : a.shown.animation === want.animation ? want.reason : 'state'; if (!allowed) visible = false;
    return { animation: a.shown.animation, loop: a.shown.loop, color: set.color, visible, reason };
  }
  function schedule(id: string, ms: number) { const old = timers.get(id); if (old !== undefined) d.clock.clearTimeout(old); timers.set(id, d.clock.setTimeout(() => { timers.delete(id); publish(id); }, Math.max(1, ms))); }
  const last = new Map<string, string>();
  /** Subscribers hear about a change of what is shown, not about every input. */
  function publish(id: string) { const v = settle(id); const key = JSON.stringify(v); if (last.get(id) === key) return; last.set(id, key); for (const f of subs) f(id, v); }
  const celebrate = (a: Agent, id: string, milestone: boolean) => { const t = now(); let animation = 'thumbs_up'; if (milestone && t - lastCelebrate >= CELEBRATE_GAP_MS) { animation = 'celebrate'; lastCelebrate = t; } else if (animation === 'thumbs_up') { /* a plain success does not count as a celebration */ } a.oneShot = { animation, until: t + ONE_SHOT_MS }; a.failures = 0; schedule(id, ONE_SHOT_MS + 1); };
  return {
    input(i) {
      const id = (i as { agentId?: string }).agentId ?? 'main'; const a = get(id); const t = now();
      switch (i.type) {
        case 'state': {
          if (i.state === 'idle' || i.state === 'ready') { const hadWork = a.active.size > 0; a.active.clear(); a.workSince = undefined; a.idleSince = t; if (hadWork) a.lastBeat = undefined; }
          else if (i.state === 'success') { celebrate(a, id, false); a.active.clear(); a.workSince = undefined; a.idleSince = t; }
          else if (i.state === 'celebrate') { celebrate(a, id, false); }
          else { for (const s of [...a.active.keys()]) if (priorityOf(s) >= 4 && priorityOf(i.state) >= 4 && s !== i.state) a.active.delete(s); if (!a.active.has(i.state)) a.active.set(i.state, t); if (priorityOf(i.state) <= 6 && a.workSince === undefined) a.workSince = t; a.idleSince = t; }
          break; }
        case 'clear': a.active.delete(i.state); if (!a.active.size) { a.workSince = undefined; a.idleSince = t; } break;
        case 'tool-call': a.calls = [...a.calls.filter((c) => t - c <= BURST_WINDOW_MS), t]; a.lastCall = t; a.idleSince = t; schedule(id, BURST_WINDOW_MS + 1); break;
        case 'milestone': celebrate(a, id, true); break;
        case 'failure': if (!i.retry) { a.failures++; a.oneShot = { animation: a.failures >= 2 ? 'worried' : 'error', until: t + ONE_SHOT_MS }; schedule(id, ONE_SHOT_MS + 1); } break;
        case 'activity': a.idleSince = t; break;
      }
      publish(id);
    },
    view: settle,
    chips(id) { const a = get(id); const s = top(a); return [...a.active.keys()].filter((x) => x !== s).sort((x, y) => priorityOf(x) - priorityOf(y)); },
    setSuppressed(reason, on) { if (on) suppressed.add(reason); else suppressed.delete(reason); for (const id of agents.keys()) publish(id); },
    show(id, on) { get(id).shownByForce = on; publish(id); },
    subscribe(fn) { subs.add(fn); return () => { subs.delete(fn); }; },
  };
}
