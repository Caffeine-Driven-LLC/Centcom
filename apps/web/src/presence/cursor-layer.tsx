import React, { useEffect, useState } from 'react';
import { VAR, INITIAL_ON } from './slots.js';
import { visibleCursors, type CursorMark, type RemoteCursor } from './cursors.js';
import type { Member } from './roster.js';

/** A 4x6 pixel arrow, drawn on a pixel grid and scaled 3x so its edges stay sharp. */
const ARROW = 'M0 0h1v1h1v1h1v1H2v1h1v2H2V5H1V4H0z';
export const CURSOR_PX = { w: 4, h: 6, scale: 3 } as const;

/**
 * The cursors of the other people over a code or diff view. The parent is the positioned box that holds the lines: a cursor sits at
 * `line` x `--cc-line-h` from the top (default 1.5em) and `col` x 1ch from the left. Each has the person's name on a tag (identity is never
 * colour alone), dims to 40 % after 3 s without news and is gone after 10 s; fading runs on the time the frame arrived here. The layer is
 * decoration for pointer users and is hidden from screen readers; nothing depends on it (presence is best effort).
 */
export function CursorLayer({ cursors, roster, me, path, now, tickMs = 1000 }: { cursors: ReadonlyMap<string, RemoteCursor> | Iterable<RemoteCursor>; roster: readonly Pick<Member, 'id' | 'name' | 'slot'>[]; me: string; path: string; now?: number; tickMs?: number }): React.JSX.Element {
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => { if (now !== undefined) return; const h = setInterval(() => setClock(Date.now()), tickMs); return () => clearInterval(h); }, [now, tickMs]);
  const list = cursors instanceof Map ? [...cursors.values()] : [...(cursors as Iterable<RemoteCursor>)];
  const marks: CursorMark[] = visibleCursors(list, { me, path, members: [...roster], now: now ?? clock });
  return <div className="cc-cursors" aria-hidden="true" data-testid="cursor-layer">{marks.map((m) => <Cursor key={m.member} mark={m} />)}</div>;
}
function Cursor({ mark }: { mark: CursorMark }): React.JSX.Element {
  const col = mark.colour; const bg = VAR[col === 'violet-outlined' ? 'violet' : col]; const fg = VAR[INITIAL_ON[col]];
  return <span className="cc-cursor" data-member={mark.member} data-colour={col} data-dim={mark.opacity < 1 ? 'true' : 'false'} ref={(el) => { if (el) { el.style.setProperty('--cu-bg', bg); el.style.setProperty('--cu-fg', fg); el.style.setProperty('--cu-line', String(mark.line)); el.style.setProperty('--cu-col', String(mark.col)); el.style.opacity = String(mark.opacity); } }}>
    <svg className="cc-cursor__arrow" width={CURSOR_PX.w * CURSOR_PX.scale} height={CURSOR_PX.h * CURSOR_PX.scale} viewBox={`0 0 ${CURSOR_PX.w} ${CURSOR_PX.h}`} shapeRendering="crispEdges" focusable="false"><path d={ARROW} fill="var(--cu-bg)" /></svg>
    <span className="cc-cursor__tag">{mark.initial} {mark.name}</span>
  </span>;
}
