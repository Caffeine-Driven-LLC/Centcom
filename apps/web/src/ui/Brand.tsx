import React from 'react';

/** Cento's body on its 12 x 12 grid (assets/mascot/cento-idle-a.svg): a antenna tip, b shadow, c body, d highlight, e ink. The colours come from CSS tokens, so the mark follows the theme. */
const MARK = ['.....aa.....', '.....bb.....', '..cccccccc..', '.dccccccccc.', '.cccccccccc.', 'cccccccccccc', 'cccecccceccc', 'cccecccceccc', 'ccccceeccccc', 'bccccccccccb', 'cc.cc..cc.cc', 'c.cc....cc.c'];
/** The still Cento mark for the app frame and empty states. Decorative: the text next to it says what it is. */
export function CentoMark({ size = 24 }: { size?: number }): React.JSX.Element {
  return <svg className="cc-mark" width={size} height={size} viewBox="0 0 12 12" aria-hidden="true" focusable="false" shapeRendering="crispEdges">
    {MARK.flatMap((row, y) => [...row].map((c, x) => (c === '.' ? null : <rect key={`${x}.${y}`} className={`cc-mk-${c}`} x={x} y={y} width={1} height={1} />)))}
  </svg>;
}
