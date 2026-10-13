import { useEffect, useMemo, useRef } from 'react';
import { PresencePublisher, type Clock, type Sink } from './publisher.js';

const realClock: Clock = { now: () => Date.now(), setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) };
export interface PresenceControls { setActivity(a: 'idle' | 'typing' | 'reviewing' | 'running'): void; setStatus(s: 'online' | 'away' | 'busy'): void; /** call on key and pointer events */ input(typing?: boolean): void; cursor(c: Record<string, unknown> | null): void }
/**
 * Your presence for the page: sends `presence.update` at most once a second (only on change), `presence.cursor` at most 10 a second, goes
 * away after 5 minutes without input and comes back on the next one. `sink` is where the frames go (a missing one drops them: presence is
 * best effort). The publisher is stopped when the page closes.
 */
export function usePresencePublisher(sink: Sink | undefined, clock: Clock = realClock): PresenceControls {
  const target = useRef<Sink | undefined>(sink); target.current = sink;
  const pub = useMemo(() => new PresencePublisher({ update: (p) => target.current?.update(p), cursor: (c) => target.current?.cursor(c) }, clock), [clock]);
  useEffect(() => () => pub.dispose(), [pub]);
  return useMemo<PresenceControls>(() => ({
    setActivity: (a) => { if (a === 'typing') pub.input(true); else if (a === 'running') pub.setAgents(1, true); else pub.setReviewing(a === 'reviewing'); },
    setStatus: (s) => { if (s === 'away') pub.input(false); else pub.setStatus(s === 'busy' ? 'busy' : 'online'); },
    input: (typing = false) => pub.input(typing), cursor: (c) => pub.cursor(c),
  }), [pub]);
}
