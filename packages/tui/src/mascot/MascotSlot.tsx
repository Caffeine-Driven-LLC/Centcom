import React, { useEffect, useState } from 'react';
import type { MascotDriver, MascotView } from './driver.js';

/** Renders the mascot from the driver's view when it may be seen; nothing otherwise. `render` draws the animation (the half-block renderer of lane C033). */
export function MascotSlot({ driver, agentId, render }: { driver: MascotDriver; agentId: string; render: (v: MascotView) => React.ReactNode }) {
  const [v, setV] = useState<MascotView>(() => driver.view(agentId));
  useEffect(() => driver.subscribe((id, view) => { if (id === agentId) setV(view); }), [driver, agentId]);
  return v.visible ? <>{render(v)}</> : null;
}
