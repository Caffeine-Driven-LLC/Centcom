import { spawn } from 'node:child_process';

/** Put text on the system clipboard. Terminals that support OSC 52 (most do, also over ssh) get it from the escape code; local tools are tried as well. Never throws. */
export function copyToClipboard(text: string, out: { write(s: string): unknown } = process.stdout, env: NodeJS.ProcessEnv = process.env, platform: string = process.platform): void {
  try { out.write(`\x1b]52;c;${Buffer.from(text, 'utf8').toString('base64')}\x07`); } catch { /* not a terminal */ }
  const tools: [string, string[]][] = platform === 'darwin' ? [['pbcopy', []]] : platform === 'win32' ? [['clip', []]] : [...(env.WAYLAND_DISPLAY ? [['wl-copy', []] as [string, string[]]] : []), ['xclip', ['-selection', 'clipboard']], ['xsel', ['--clipboard', '--input']]];
  const next = (i: number): void => {
    const t = tools[i]; if (!t) return;
    try { const c = spawn(t[0], t[1], { stdio: ['pipe', 'ignore', 'ignore'], detached: true }); c.on('error', () => next(i + 1)); c.stdin?.on('error', () => undefined); c.stdin?.end(text); c.unref(); } catch { next(i + 1); }
  };
  next(0);
}
