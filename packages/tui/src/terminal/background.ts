/** Asks the terminal for its background colour (OSC 11) to pick dark or light; gives up after 150 ms. */
export interface QueryIo { out: { isTTY?: boolean; write(s: string): unknown }; inp: { isTTY?: boolean; on(e: 'data', f: (b: Buffer | string) => void): unknown; off(e: 'data', f: (b: Buffer | string) => void): unknown; setRawMode?(on: boolean): unknown; isRaw?: boolean; resume?(): unknown; pause?(): unknown; listeners?(e: string): unknown[]; removeAllListeners?(e: string): unknown } }
export interface QueryClock { setTimeout(f: () => void, ms: number): unknown; clearTimeout(h: unknown): void }

/** Both `rgb:RR/GG/BB` and `rgb:RRRR/GGGG/BBBB` forms (and 1 or 3 digit channels). */
export function parseOsc11(s: string): 'dark' | 'light' | undefined {
  const m = /rgb:([0-9a-f]{1,4})\/([0-9a-f]{1,4})\/([0-9a-f]{1,4})/i.exec(s); if (!m) return undefined;
  const ch = (h: string) => parseInt(h, 16) / (16 ** h.length - 1); const [r, g, b] = [ch(m[1]!), ch(m[2]!), ch(m[3]!)];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.5 ? 'dark' : 'light';
}
export function queryBackground(io: QueryIo, timeoutMs = 150, clock: QueryClock = { setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (h) => clearTimeout(h as NodeJS.Timeout) }): Promise<'dark' | 'light' | 'unknown'> {
  if (!io.out.isTTY || !io.inp.isTTY) return Promise.resolve('unknown'); // nothing is written when there is no terminal
  return new Promise((resolve) => {
    let buf = ''; let done = false; const wasRaw = !!io.inp.isRaw;
    const finish = (v: 'dark' | 'light' | 'unknown') => { if (done) return; done = true; clock.clearTimeout(timer); io.inp.off('data', onData); try { io.inp.setRawMode?.(wasRaw); } catch { /* not a real TTY */ } io.inp.pause?.(); resolve(v); };
    /* the reply is read here and goes nowhere else: it is never handed to the prompt */
    const onData = (b: Buffer | string) => { buf += b.toString(); if (/(\x07|\x1b\\)/.test(buf) || /rgb:[0-9a-f/]+$/i.test(buf) && buf.length > 20) finish(parseOsc11(buf) ?? 'unknown'); };
    const timer = clock.setTimeout(() => finish('unknown'), timeoutMs);
    try { io.inp.setRawMode?.(true); } catch { /* ignore */ }
    io.inp.on('data', onData); io.inp.resume?.(); io.out.write('\x1b]11;?\x07');
  });
}
