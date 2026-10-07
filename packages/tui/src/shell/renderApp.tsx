import React from 'react';
import { render } from 'ink';
import { Shell, type ShellSlots } from './Shell.js';
import { createScreenGuard, type ProcLike } from './screen.js';
import { watchSizeOf } from './size.js';

export interface AppHandle { unmount(): void; waitUntilExit(): Promise<void> }
/** Mounts the shell on a terminal: alternate screen on (unless disabled) and always restored, a relayout at most every 50 ms while resizing. */
export function renderApp(o: { slots: ShellSlots | (() => ShellSlots); stdout?: NodeJS.WriteStream; stdin?: NodeJS.ReadStream; altScreen?: boolean; proc?: ProcLike; promptRows?: number; /** Ink writes every frame in full (tests). */ debug?: boolean }): AppHandle {
  const out = o.stdout ?? process.stdout; const guard = createScreenGuard({ stdout: out, proc: o.proc ?? (process as unknown as ProcLike), enabled: o.altScreen !== false }); guard.enter();
  const App = () => { const size = watchSizeOf(out); const slots = typeof o.slots === 'function' ? o.slots() : o.slots; return <Shell slots={slots} cols={size.cols} rows={size.rows} promptRows={o.promptRows} />; };
  const inst = render(<App />, { stdout: out, stdin: o.stdin, exitOnCtrlC: false, patchConsole: false, debug: o.debug });
  const done = inst.waitUntilExit().then(() => undefined, () => undefined).finally(() => guard.dispose());
  return { unmount: () => { inst.unmount(); guard.leave(); }, waitUntilExit: () => done };
}
