/** The alternate screen: entered at start, always left again (normal exit, SIGINT, SIGTERM, an uncaught error), cursor back. */
export const ENTER = '\u001b[?1049h\u001b[2J\u001b[H'; export const LEAVE = '\u001b[?25h\u001b[?1049l';
export interface ProcLike { on(e: string, f: (...a: unknown[]) => void): unknown; off(e: string, f: (...a: unknown[]) => void): unknown; kill?(pid: number, sig: string): unknown; pid?: number }
export interface Guard { enter(): void; leave(): void; dispose(): void; active(): boolean }
export function createScreenGuard(d: { stdout: { write(s: string): unknown }; proc: ProcLike; enabled?: boolean }): Guard {
  let on = false; const enabled = d.enabled !== false;
  const leave = () => { if (!on) return; on = false; d.stdout.write(LEAVE); };
  const enter = () => { if (!enabled || on) return; on = true; d.stdout.write(ENTER); };
  /* a signal or an uncaught error leaves the screen first, then lets the process end the way it would have */
  const onSig = (sig: string) => () => { leave(); d.proc.off('SIGINT', sigint); d.proc.off('SIGTERM', sigterm); d.proc.kill?.(d.proc.pid ?? 0, sig); };
  const sigint = onSig('SIGINT'); const sigterm = onSig('SIGTERM'); const onExit = () => leave(); const onErr = () => leave();
  d.proc.on('SIGINT', sigint); d.proc.on('SIGTERM', sigterm); d.proc.on('exit', onExit); d.proc.on('uncaughtException', onErr);
  return { enter, leave, active: () => on, dispose() { leave(); d.proc.off('SIGINT', sigint); d.proc.off('SIGTERM', sigterm); d.proc.off('exit', onExit); d.proc.off('uncaughtException', onErr); } };
}
