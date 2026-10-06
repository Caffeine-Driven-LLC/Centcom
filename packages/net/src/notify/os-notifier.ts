/** Shows a notification with the operating system's own tool. The text goes in as separate arguments (no shell), after being cleaned and cut to length. */
import { spawn } from 'node:child_process';
import { sanitise } from './render.js';

export interface OsNotifier { show(o: { title: string; body: string; sound?: boolean }): Promise<boolean> }
export type Runner = (cmd: string, args: string[], env?: Record<string, string>) => Promise<boolean>;
const MAX_TITLE = 80; const MAX_BODY = 240;
const clip = (s: string, n: number) => { const t = sanitise(s); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

export const defaultRunner: Runner = (cmd, args, env) => new Promise((res) => {
  try { const p = spawn(cmd, args, { stdio: 'ignore', shell: false, windowsHide: true, ...(env ? { env: { ...process.env, ...env } } : {}) }); const t = setTimeout(() => { p.kill(); res(false); }, 5000); p.on('error', () => { clearTimeout(t); res(false); }); p.on('exit', (c) => { clearTimeout(t); res(c === 0); }); } catch { res(false); }
});
/** The text reaches AppleScript as arguments and PowerShell as environment variables (PowerShell would paste arguments into the command), so it is never spliced into a script. */
export const MAC_SCRIPT = 'on run argv\ndisplay notification (item 2 of argv) with title (item 1 of argv)\nend run';
export const WIN_SCRIPT = '$t=$env:CENTCOM_NOTIFY_TITLE;$b=$env:CENTCOM_NOTIFY_BODY;[void][Windows.UI.Notifications.ToastNotificationManager,Windows.UI.Notifications,ContentType=WindowsRuntime];$x=[Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent(0);$n=$x.GetElementsByTagName("text");$n.Item(0).AppendChild($x.CreateTextNode($t))|Out-Null;$n.Item(1).AppendChild($x.CreateTextNode($b))|Out-Null;[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("Centcom").Show([Windows.UI.Notifications.ToastNotification]::new($x))';

export function createOsNotifier(platform: NodeJS.Platform, run: Runner = defaultRunner): OsNotifier {
  return {
    async show(o) {
      const title = clip(o.title, MAX_TITLE) || 'Centcom'; const body = clip(o.body, MAX_BODY);
      if (platform === 'linux') return run('notify-send', ['--app-name=Centcom', '--', title, body]);
      if (platform === 'darwin') return run('osascript', ['-e', MAC_SCRIPT, title, body]);
      if (platform === 'win32') return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', WIN_SCRIPT], { CENTCOM_NOTIFY_TITLE: title, CENTCOM_NOTIFY_BODY: body });
      return false;
    },
  };
}
