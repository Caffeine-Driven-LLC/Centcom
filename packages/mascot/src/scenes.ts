/**
 * Terminal-sized Cento scenes: one per product state. Frames are specs (face, arms, props), rendered
 * to pixel rows on demand and cropped to one shared window per scene so frames never jiggle.
 */
import { Canvas, unionWindow } from './canvas.js';
import { centoPixels, type CentoSpec } from './sprite.js';
import { propRows, type PropItem } from './props.js';
import type { CentoColor } from './palette.js';

export interface SceneFrame { ms: number; spec: CentoSpec; props?: PropItem[]; dx?: number; dy?: number }
export interface Scene { name: string; frames: SceneFrame[]; /** one-shot scenes play once then hand control back */ once?: boolean }

const F = (ms: number, spec: CentoSpec, props: PropItem[] = [], dx = 0, dy = 0): SceneFrame => ({ ms, spec, props, dx, dy });
const P = (k: string, dr: number, dc: number, extra: Partial<PropItem> = {}): PropItem => ({ k, dr, dc, ...extra });

const RIGHT = 14; // props to the right of the body start here

export const SCENES: Record<string, Scene> = {
  idle: { name: 'idle', frames: [
    F(1600, { e: 'open', m: 'flat', lg: 'a' }), F(110, { e: 'closed', m: 'flat', lg: 'a' }), F(1900, { e: 'open', m: 'flat', lg: 'b' }),
    F(1300, { e: 'open', m: 'small', lg: 'a' }), F(110, { e: 'closed', lg: 'a' }), F(130, { e: 'open', lg: 'b' }), F(110, { e: 'closed', lg: 'b' }), F(2200, { e: 'open', lg: 'a' }),
  ] },
  ready: { name: 'ready', frames: [
    F(1500, { e: 'open', m: 'smile', lg: 'a' }), F(110, { e: 'closed', m: 'smile', lg: 'a' }), F(1700, { e: 'open', m: 'smile', lg: 'b' }),
    F(500, { e: 'happy', m: 'smile', al: 'upw', lg: 'a' }), F(500, { e: 'happy', m: 'smile', al: 'up', lg: 'b' }), F(500, { e: 'happy', m: 'smile', al: 'upw', lg: 'a' }),
  ] },
  thinking: { name: 'thinking', frames: [1, 2, 3, 3, 2, 1, 0].map((n, i) => F(i === 6 ? 220 : 340, { e: i % 2 ? 'up' : ['up', 'right'], m: 'small', lg: i % 2 ? 'a' : 'b' }, [P('dots', 0, RIGHT - 1, { n })])) },
  'thinking-hard': { name: 'thinking-hard', frames: [
    F(260, { e: 'squint', m: 'zig', acc: ['sweat'], lg: 'a' }, [P('bulb', 0, RIGHT)]), F(260, { e: 'squint', m: 'zig', acc: ['sweat'], lg: 'b' }),
    F(260, { e: 'squint', m: 'zig', acc: ['sweat'], lg: 'a' }, [P('bulb', 0, RIGHT)]), F(260, { e: ['up', 'squint'], m: 'zig', acc: ['sweat'], lg: 'b' }),
  ] },
  planning: { name: 'planning', frames: [
    F(420, { e: 'right', m: 'small', acc: ['glasses'], lg: 'a' }, [P('dots', 0, RIGHT - 1, { n: 1 })]), F(420, { e: 'right', m: 'small', acc: ['glasses'], lg: 'b' }, [P('dots', 0, RIGHT - 1, { n: 2 })]),
    F(420, { e: 'down', m: 'small', acc: ['glasses'], lg: 'a' }, [P('dots', 0, RIGHT - 1, { n: 3 })]),
  ] },
  searching: { name: 'searching', frames: [0, 2, 4, 6, 4, 2].map((x, i) => F(240, { e: x < 4 ? 'right' : 'left', m: 'small', ar: 'far', lg: i % 2 ? 'a' : 'b' }, [P('magnifier', 3, RIGHT + x)])) },
  'reading-file': { name: 'reading-file', frames: [
    F(380, { e: 'right', m: 'small', acc: ['glasses'], lg: 'a' }, [P('file', 3, RIGHT)]), F(380, { e: 'down', m: 'small', acc: ['glasses'], lg: 'b' }, [P('file', 3, RIGHT)]),
    F(380, { e: 'right', m: 'small', acc: ['glasses'], lg: 'a' }, [P('file', 3, RIGHT)]), F(380, { e: 'down', m: 'flat', acc: ['glasses'], lg: 'b' }, [P('file', 3, RIGHT)]),
  ] },
  'editing-file': { name: 'editing-file', frames: [0, 1, 2, 1].map((k, i) => F(200, { e: 'down', m: 'small', ar: i % 2 ? 'far' : 'out', lg: i % 2 ? 'a' : 'b' }, [P('file', 3, RIGHT + 2), P('pencil', 2 + (k % 2), RIGHT - 1 + k)])) },
  'creating-file': { name: 'creating-file', frames: [
    F(220, { e: 'up', m: 'small' }, [P('twinkle', 4, RIGHT + 2)]), F(220, { e: 'ring', m: 'open' }, [P('spark_s', 3, RIGHT + 2), P('file', 4, RIGHT + 4)]),
    F(380, { e: 'star', m: 'grin', ar: 'far' }, [P('file', 3, RIGHT + 2)]),
  ] },
  'running-command': { name: 'running-command', frames: [0, 1, 2, 3].map((i) => F(170, { e: 'right', m: 'small', ar: i % 2 ? 'far' : 'out', lg: i % 2 ? 'a' : 'b' }, [P(i % 2 ? 'gear_a' : 'gear_b', 3, RIGHT + 2)])) },
  'tool-running': { name: 'tool-running', frames: [0, 1, 2, 3].map((i) => F(170, { e: 'right', m: 'small', ar: i % 2 ? 'far' : 'out', lg: i % 2 ? 'a' : 'b' }, [P(i % 2 ? 'gear_a' : 'gear_b', 3, RIGHT + 2)])) },
  streaming: { name: 'streaming', frames: [0, 1, 2, 3].map((i) => F(210, { e: 'open', m: i % 2 ? 'open' : 'small', lg: i % 2 ? 'a' : 'b' }, [P(i % 2 ? 'note' : 'note_p', 1 + (i % 3), RIGHT + (i % 2) * 2)])) },
  compacting: { name: 'compacting', frames: [
    F(220, { e: 'closed', m: 'flat' }), F(220, { e: 'squint', m: 'flat', al: 'out', ar: 'out', lg: 'tuck' }, [], 0, 1), F(240, { e: 'squint', m: 'small', al: 'side', ar: 'side', lg: 'tuck' }, [P('puff', 7, 13), P('puff', 7, -4)], 0, 2), F(260, { e: 'happy', m: 'smile' }),
  ] },
  'awaiting-approval': { name: 'awaiting-approval', frames: [
    F(520, { e: 'up', m: 'small', tip: 'Y', lg: 'a' }, [P('shield', 2, RIGHT)]), F(520, { e: ['up', 'right'], m: 'small', tip: 'Y', lg: 'b' }, [P('shield', 3, RIGHT)]),
  ] },
  'asking-question': { name: 'asking-question', frames: [
    F(420, { e: 'up', m: 'small', tip: 'Y', lg: 'a' }, [P('text', 1, RIGHT + 1, { s: '?', color: 'Y' })]), F(420, { e: 'right', m: 'small', tip: 'Y', lg: 'b' }, [P('text', 2, RIGHT + 1, { s: '?', color: 'Y' })]),
  ] },
  approved: { name: 'approved', once: true, frames: [
    F(260, { e: 'happy', m: 'smile', ar: 'up' }, [P('check', 3, RIGHT)]), F(700, { e: 'happy', m: 'grin', ar: 'up' }, [P('check', 3, RIGHT), P('spark_s', 0, RIGHT + 4)]),
  ] },
  denied: { name: 'denied', once: true, frames: [
    F(300, { e: 'angry', m: 'flat', al: 'out', ar: 'out' }, [P('xmark_s', 4, RIGHT)], -1), F(300, { e: 'angry', m: 'flat', al: 'out', ar: 'out' }, [P('xmark_s', 4, RIGHT)], 1), F(500, { e: 'squint', m: 'flat', al: 'out', ar: 'out' }, [P('xmark_s', 4, RIGHT)]),
  ] },
  success: { name: 'success', once: true, frames: [
    F(200, { e: 'happy', m: 'grin', al: 'cheer', ar: 'cheer', lg: 'tuck' }, [P('spark_s', 0, -5), P('spark_s', 2, RIGHT + 1)], 0, -1),
    F(200, { e: 'happy', m: 'grin', al: 'cheer', ar: 'cheer', lg: 'a' }, [P('twinkle', 1, -5), P('twinkle', 0, RIGHT + 2)]),
    F(200, { e: 'happy', m: 'grin', al: 'cheer', ar: 'cheer', lg: 'tuck' }, [P('spark_s', 2, -5), P('spark_s', 0, RIGHT + 1)], 0, -1),
    F(1200, { e: 'happy', m: 'smile', ar: 'up' }, [P('heart_s', 1, RIGHT)]),
  ] },
  celebrate: { name: 'celebrate', once: true, frames: [0, 1, 2, 3, 4, 5, 6, 7].map((i) => F(200, { e: 'happy', m: 'grin', al: 'cheer', ar: 'cheer', lg: i % 2 ? 'a' : 'tuck' }, [P(i % 2 ? 'confetti_a' : 'confetti_b', -4 + (i % 4), 1)], 0, i % 2 ? 0 : -1)) },
  error: { name: 'error', frames: [-1, 1, -1, 1, 0, 0].map((x, i) => F(i < 4 ? 110 : 600, { e: 'x', m: 'frown', tip: 'R', acc: ['sweat'] }, [P('text', 0, RIGHT, { s: '!', color: 'r' })], x)) },
  crash: { name: 'crash', frames: [
    F(140, { e: 'ring', m: 'gasp', tip: 'R' }, [P('puff', 1, RIGHT)]), F(140, { e: 'x', m: 'gasp', tip: 'R' }, [P('puff', 0, RIGHT + 1), P('puff', 4, -4)]), F(600, { e: 'x', m: 'frown', tip: 'R', lg: 'tuck' }, [P('puff', 0, RIGHT + 2)], 0, 1),
  ] },
  warning: { name: 'warning', frames: [
    F(380, { e: 'sad', m: 'zig', acc: ['sweat'] }, [P('text', 0, RIGHT, { s: '!', color: 'Y' })]), F(380, { e: ['sad', 'left'], m: 'zig', acc: ['sweat'], lg: 'b' }, [P('text', 0, RIGHT, { s: '!', color: 'Y' })]),
  ] },
  sleeping: { name: 'sleeping', frames: [
    F(700, { e: 'closed', m: 'small', lg: 'tuck', tip: 'g' }, [P('text', 0, RIGHT, { s: 'Z', color: 'v' })], 0, 1), F(700, { e: 'closed', m: 'small', lg: 'tuck', tip: 'g' }, [P('text', 0, RIGHT, { s: 'Z', color: 'v' }), P('text', -6, RIGHT + 4, { s: 'Z', color: 'w' })], 0, 1),
    F(700, { e: 'closed', m: 'open', lg: 'tuck', tip: 'g' }, [P('text', -2, RIGHT + 2, { s: 'Z', color: 'v' })], 0, 2),
  ] },
  'sub-agent': { name: 'sub-agent', frames: [
    F(220, { e: 'up', m: 'open', ar: 'up' }), F(220, { e: 'star', m: 'grin', ar: 'up' }, [P('spark_s', 2, RIGHT), P('twinkle', 0, -5)]), F(300, { e: 'happy', m: 'grin', ar: 'up' }, [P('spark_s', 0, RIGHT + 1), P('spark_s', 4, -5)]),
  ] },
  'provider-auth-required': { name: 'provider-auth-required', frames: [
    F(500, { e: 'right', m: 'flat', tip: 'Y' }, [P('lock', 2, RIGHT)]), F(500, { e: 'up', m: 'small', tip: 'Y' }, [P('lock', 3, RIGHT)]),
  ] },
  'provider-cap-reached': { name: 'provider-cap-reached', frames: [
    F(600, { e: 'sad', m: 'flat' }, [P('hourglass_a', 2, RIGHT)]), F(600, { e: 'squint', m: 'flat', lg: 'b' }, [P('hourglass_b', 2, RIGHT)]),
  ] },
  welcome: { name: 'welcome', frames: [
    F(260, { e: 'happy', m: 'smile', al: 'upw' }, [P('twinkle', 0, -5), P('twinkle', 3, RIGHT + 1)]), F(260, { e: 'happy', m: 'smile', al: 'up' }, [P('spark_s', 1, RIGHT + 1)]),
    F(260, { e: 'happy', m: 'grin', al: 'upw', lg: 'b' }, [P('twinkle', 2, -5), P('twinkle', 0, RIGHT + 2)]), F(260, { e: 'happy', m: 'smile', al: 'up', lg: 'b' }, [P('spark_s', 1, -5)]),
  ] },
};

/** product state name (contracts/state-map.json keys) -> scene */
export const SCENE_FOR_STATE: Record<string, string> = {
  idle: 'idle', ready: 'ready', listening: 'ready', 'prompt-received': 'thinking',
  thinking: 'thinking', 'thinking-hard': 'thinking-hard', planning: 'planning', searching: 'searching',
  'reading-file': 'reading-file', 'editing-file': 'editing-file', 'creating-file': 'creating-file', 'deleting-file': 'editing-file',
  'running-command': 'running-command', 'tool-running': 'tool-running', streaming: 'streaming', compacting: 'compacting',
  'background-task': 'tool-running', 'sub-agent': 'sub-agent', 'awaiting-approval': 'awaiting-approval', 'asking-question': 'asking-question',
  approved: 'approved', denied: 'denied', success: 'success', celebrate: 'celebrate', error: 'error', crash: 'crash', warning: 'warning',
  'tests-pass': 'success', 'tests-fail': 'warning', 'merge-conflict': 'warning', deploying: 'tool-running', saving: 'success',
  sleeping: 'sleeping', away: 'sleeping', 'provider-auth-required': 'provider-auth-required', 'auth-required': 'provider-auth-required',
  'provider-cap-reached': 'provider-cap-reached', 'rate-limited': 'provider-cap-reached', 'quota-reached': 'provider-cap-reached',
  'first-run': 'welcome', empty: 'ready', 'context-full': 'compacting',
};

export interface RenderedFrame { ms: number; rows: string[] }
const cache = new Map<string, { frames: RenderedFrame[]; width: number; height: number }>();

/** Render a scene to pixel rows (cropped to one window shared by all frames). */
export function renderScene(name: string, color: CentoColor = 'violet'): { frames: RenderedFrame[]; width: number; height: number } {
  const id = `${name}:${color}`;
  const hit = cache.get(id);
  if (hit) return hit;
  const scene = SCENES[name];
  if (!scene) throw new Error(`unknown scene ${name}`);
  const canvases = scene.frames.map((f) => {
    const cv = new Canvas();
    cv.blitPixels(centoPixels({ ...f.spec, color }), (f.dy ?? 0), (f.dx ?? 0));
    for (const p of f.props ?? []) cv.blitRows(propRows(p), p.dr, p.dc);
    return cv;
  });
  // window: the union of all frames, plus always include the full body box so the sprite never moves
  const body = new Canvas(); body.blitPixels(centoPixels({ color }), 0, 0);
  const win = unionWindow([...canvases.map((c) => c.bounds()), body.bounds()]);
  // terminal rows are 2 pixels tall: make the window an even number of rows
  if ((win.r1 - win.r0 + 1) % 2) win.r1 += 1;
  const frames = canvases.map((c, i) => ({ ms: scene.frames[i]!.ms, rows: c.toRows(win) }));
  const out = { frames, width: win.c1 - win.c0 + 1, height: win.r1 - win.r0 + 1 };
  cache.set(id, out);
  return out;
}
