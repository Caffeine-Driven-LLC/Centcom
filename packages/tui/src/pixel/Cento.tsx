import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text } from 'ink';
import type { CentoColor } from '@centcom/mascot';
import { createFrameCache, type CentoSize, type FrameCache, type Tier } from './cache.js';
import { sharedBudget, type AnimationBudget } from './budget.js';

const shared = createFrameCache(); let uid = 0;
export interface CentoProps {
  animation: string; color?: CentoColor; size?: CentoSize; playing?: boolean; loop?: boolean; onDone?: () => void;
  tier?: Tier; unicode?: boolean; /** Reduced motion: the first frame only. */ motion?: 'full' | 'reduced';
  cache?: FrameCache; budget?: AnimationBudget; clock?: { setTimeout(f: () => void, ms: number): unknown; clearTimeout(h: unknown): void };
}
/** The mascot. Each frame stays for its own duration (80 to 500 ms), frames come from a cache, and no more than 6 animate at once. */
export function Cento({ animation, color = 'violet', size = 'hero', playing = true, loop = true, onDone, tier = 'truecolor', unicode = true, motion = 'full', cache = shared, budget = sharedBudget, clock }: CentoProps) {
  const frames = useMemo(() => cache.frames(animation, color, tier, size, unicode), [cache, animation, color, tier, size, unicode]); const id = useRef(`cento_${++uid}`); const [i, setI] = useState(0); const [slot, setSlot] = useState(0);
  const animate = playing && motion !== 'reduced' && frames.length > 1;
  useEffect(() => { setI(0); }, [animation, color]);
  useEffect(() => { if (!animate) { budget.release(id.current); return; } const grab = () => { if (budget.acquire(id.current)) setSlot((n) => n + 1); }; grab(); const off = budget.subscribe(grab); return () => { off(); budget.release(id.current); }; }, [animate, budget]);
  const holding = animate && !budget.acquire(id.current) ? true : false; void slot;
  useEffect(() => {
    if (!animate || holding) return; const f = frames[i]!; const set = clock?.setTimeout ?? ((fn: () => void, ms: number) => setTimeout(fn, ms)); const clear = clock?.clearTimeout ?? ((h: unknown) => clearTimeout(h as NodeJS.Timeout));
    const h = set(() => { if (i + 1 >= frames.length) { if (loop) setI(0); else onDone?.(); } else setI(i + 1); }, f.d); return () => clear(h);
  }, [animate, holding, i, frames, loop, onDone, clock]);
  const shown = frames[animate && !holding ? i : 0]!;
  return <Box flexDirection="column">{shown.lines.map((l, k) => <Text key={k}>{l}</Text>)}</Box>;
}
