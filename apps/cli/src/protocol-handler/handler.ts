/** `centcom install-handler [--uninstall] [--dry-run]`: makes the operating system open centcom:// links with `centcom link %u`.
 *  Each platform is a plan (a list of actions) that a small executor applies, so the plans are tested everywhere and only the executor touches the machine.
 *  Nothing here puts a URL, a token or a key into an entry: the system fills in the link when it is opened. No sudo, nothing outside the user's own folders. */
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';

export type Action =
  | { kind: 'mkdir'; path: string } | { kind: 'write'; path: string; content: string; mode?: number } | { kind: 'remove'; path: string; recursive?: boolean }
  | { kind: 'removeLine'; path: string; line: string } | { kind: 'run'; cmd: string; args: string[]; /** a missing tool or a failure only warns, with these words */ optional?: string };
export interface HandlerEnv { platform: NodeJS.Platform; home: string; /** The command that starts Centcom: `[node, script]` or `[binary]`. */ exe: string[] }

/** One word of a desktop-entry Exec line (spaces, quotes and `%` are escaped as the Desktop Entry spec says). */
export const desktopQuote = (s: string): string => (/^[A-Za-z0-9._\/+:@-]+$/.test(s) ? s : `"${s.replace(/(["`$\\])/g, '\\$1').replace(/%/g, '%%')}"`);
const shQuote = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;
const winQuote = (s: string): string => `"${s.replace(/"/g, '')}"`;
const XDG_LINE = 'x-scheme-handler/centcom=centcom.desktop';
const SCHEMES_ARRAY = '<array><dict><key>CFBundleURLName</key><string>Centcom link</string><key>CFBundleURLSchemes</key><array><string>centcom</string></array></dict></array>';

export function planInstall(e: HandlerEnv): Action[] {
  if (e.platform === 'win32') {
    const cmd = `${e.exe.map(winQuote).join(' ')} link "%1"`; const k = 'HKCU\\Software\\Classes\\centcom';
    return [{ kind: 'run', cmd: 'reg', args: ['add', k, '/ve', '/d', 'URL:Centcom', '/f'] }, { kind: 'run', cmd: 'reg', args: ['add', k, '/v', 'URL Protocol', '/d', '', '/f'] }, { kind: 'run', cmd: 'reg', args: ['add', `${k}\\shell\\open\\command`, '/ve', '/d', cmd, '/f'] }];
  }
  if (e.platform === 'darwin') {
    const app = join(e.home, 'Applications', 'Centcom Link.app'); const exe = e.exe.map(shQuote).join(' ');
    const script = ['on open location u', `tell application "Terminal" to do script ("${exe.replace(/\\/g, '\\\\').replace(/"/g, '\\"')} link " & quoted form of u)`, 'tell application "Terminal" to activate', 'end open location'];
    return [{ kind: 'mkdir', path: join(e.home, 'Applications') }, { kind: 'run', cmd: 'osacompile', args: ['-o', app, ...script.flatMap((l) => ['-e', l])] },
      { kind: 'run', cmd: 'plutil', args: ['-insert', 'CFBundleURLTypes', '-xml', SCHEMES_ARRAY, join(app, 'Contents', 'Info.plist')] },
      { kind: 'run', cmd: '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister', args: ['-f', app], optional: 'Could not refresh the link registry; log out and in, or open the app once.' }];
  }
  const dir = join(e.home, '.local', 'share', 'applications');
  const desktop = ['[Desktop Entry]', 'Type=Application', 'Name=Centcom link handler', 'Comment=Opens Centcom links', `Exec=${[...e.exe.map(desktopQuote), 'link', '%u'].join(' ')}`, 'Terminal=true', 'NoDisplay=true', 'MimeType=x-scheme-handler/centcom;', ''].join('\n');
  return [{ kind: 'mkdir', path: dir }, { kind: 'write', path: join(dir, 'centcom.desktop'), content: desktop, mode: 0o644 },
    { kind: 'run', cmd: 'xdg-mime', args: ['default', 'centcom.desktop', 'x-scheme-handler/centcom'], optional: `xdg-utils is not installed, so the link was not registered. Set it up by hand: make a desktop entry that runs "centcom link %u" for x-scheme-handler/centcom.` },
    { kind: 'run', cmd: 'update-desktop-database', args: [dir], optional: '' }];
}
export function planUninstall(e: HandlerEnv): Action[] {
  if (e.platform === 'win32') return [{ kind: 'run', cmd: 'reg', args: ['delete', 'HKCU\\Software\\Classes\\centcom', '/f'] }];
  if (e.platform === 'darwin') return [{ kind: 'remove', path: join(e.home, 'Applications', 'Centcom Link.app'), recursive: true }];
  const dir = join(e.home, '.local', 'share', 'applications');
  return [{ kind: 'remove', path: join(dir, 'centcom.desktop') }, { kind: 'removeLine', path: join(e.home, '.config', 'mimeapps.list'), line: XDG_LINE }, { kind: 'run', cmd: 'update-desktop-database', args: [dir], optional: '' }];
}
/** What a plan says, as lines a person can read (`--dry-run`). */
export const describe = (actions: Action[]): string[] => actions.map((a) => (a.kind === 'mkdir' ? `create folder ${a.path}` : a.kind === 'write' ? `write ${a.path}` : a.kind === 'remove' ? `remove ${a.path}` : a.kind === 'removeLine' ? `remove the centcom line from ${a.path}` : `run ${a.cmd} ${a.args.map((x) => (/\s/.test(x) ? `"${x}"` : x)).join(' ')}`.slice(0, 220)));

export interface HandlerIo { out(l: string): void; err(l: string): void; run?(cmd: string, args: string[]): Promise<number | 'missing'> }
const realRun = (cmd: string, args: string[]): Promise<number | 'missing'> => new Promise((res) => { try { const p = spawn(cmd, args, { stdio: 'ignore' }); p.on('error', (e) => res((e as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 1)); p.on('exit', (c) => res(c ?? 1)); } catch { res('missing'); } });
/** Applies a plan. Exit code: 0 done (a tool that is only nice to have may warn), 1 something required failed. */
export async function applyPlan(actions: Action[], io: HandlerIo): Promise<number> {
  const run = io.run ?? realRun;
  for (const a of actions) {
    try {
      if (a.kind === 'mkdir') mkdirSync(a.path, { recursive: true });
      else if (a.kind === 'write') { mkdirSync(dirname(a.path), { recursive: true }); writeFileSync(a.path, a.content, { mode: a.mode ?? 0o644 }); if (a.mode) chmodSync(a.path, a.mode); }
      else if (a.kind === 'remove') rmSync(a.path, { recursive: !!a.recursive, force: true });
      else if (a.kind === 'removeLine') { if (existsSync(a.path)) { const t = readFileSync(a.path, 'utf8'); const next = t.split('\n').filter((l) => l.trim() !== a.line).join('\n'); if (next !== t) writeFileSync(a.path, next); } }
      else { const r = await run(a.cmd, a.args); if (r !== 0) { if (a.optional !== undefined) { if (a.optional) io.err(a.optional); } else { io.err(`${a.cmd} ${r === 'missing' ? 'was not found' : 'failed'}, so the link handler was not changed.`); return 1; } } }
    } catch { io.err('Could not write the link handler files.'); return 1; }
  }
  return 0;
}
export async function runInstallHandler(argv: string[], e: HandlerEnv, io: HandlerIo): Promise<number> {
  const bad = argv.filter((a) => !['--uninstall', '--dry-run'].includes(a)); if (bad.length) { io.err('Usage: centcom install-handler [--uninstall] [--dry-run]'); return 2; }
  const un = argv.includes('--uninstall'); const plan = un ? planUninstall(e) : planInstall(e);
  if (argv.includes('--dry-run')) { for (const l of describe(plan)) io.out(l); return 0; }
  const code = await applyPlan(plan, io); if (code === 0) io.out(un ? 'centcom:// links are no longer opened with Centcom.' : 'centcom:// links now open with Centcom (it asks before doing anything).'); return code;
}
/** Starts a program without a shell and waits for its exit code (255 when it cannot start). */
export const runDetached = async (cmd: string, args: string[]): Promise<number> => { const r = await realRun(cmd, args); return r === 'missing' ? 255 : r; };
/** The command that starts this Centcom: the program itself when it is a single executable, otherwise node and the script. */
export async function startCommand(): Promise<string[]> {
  let sea = false; try { const m = await import('node:sea'); sea = m.isSea(); } catch { /* an older node has no single-executable support */ }
  return process.argv[1] && !sea ? [process.execPath, process.argv[1]] : [process.execPath];
}
