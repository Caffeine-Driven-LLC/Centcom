/** Sends your own cursor and selection: at most `maxHz` a second, only when it changed, always ending on the latest position (lane C077). Paths and lines travel only inside the encrypted payload that the presence client builds. */
import { useEffect, useMemo } from 'react';
import type { PresenceClient } from '@centcom/net';

export interface CursorPos { path?: string; line?: number; col?: number; selEndLine?: number; selEndCol?: number }
export interface CursorSink { setCursor(c: CursorPos | null): void }
export interface PublisherClock { now(): number; setTimeout(fn: () => void, ms: number): unknown; clearTimeout(h: never): void }
export interface CursorPublisher { publish(pos: CursorPos): void; clear(): void; dispose(): void }
const realClock: PublisherClock = { now: () => Date.now(), setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (h: never) => clearTimeout(h as unknown as ReturnType<typeof setTimeout>) };

export function createCursorPublisher(client: CursorSink, o: { maxHz?: number; clock?: PublisherClock } = {}): CursorPublisher {
  const clock = o.clock ?? realClock; const gap = Math.ceil(1000 / Math.max(1, Math.min(10, o.maxHz ?? 10))); let last = -Infinity; let sentKey = ''; let pending: CursorPos | undefined; let timer: unknown; let off = false;
  const key = (p: CursorPos) => JSON.stringify([p.path, p.line, p.col, p.selEndLine, p.selEndCol]);
  const flush = (): void => { timer = undefined; if (off || !pending) return; const p = pending; pending = undefined; if (key(p) === sentKey) return; sentKey = key(p); last = clock.now(); try { client.setCursor(p); } catch { /* presence is best effort */ } };
  return {
    publish(pos) {
      if (off) return; pending = pos; if (timer !== undefined) return; const wait = last + gap - clock.now();
      if (wait <= 0) flush(); else timer = clock.setTimeout(flush, wait);
    },
    clear() { pending = undefined; if (timer !== undefined) { clock.clearTimeout(timer as never); timer = undefined; } sentKey = ''; try { client.setCursor(null); } catch { /* same */ } },
    dispose() { off = true; pending = undefined; if (timer !== undefined) clock.clearTimeout(timer as never); timer = undefined; },
  };
}
/** The hook form: one publisher for the life of the component; it stops when the component goes away. */
export function useCursorPublisher(client: PresenceClient | CursorSink, opts?: { maxHz?: number; clock?: PublisherClock }): { publish(pos: CursorPos): void } {
  const pub = useMemo(() => createCursorPublisher(client, opts), [client, opts?.maxHz, opts?.clock]);
  useEffect(() => () => pub.dispose(), [pub]);
  return { publish: pub.publish };
}
