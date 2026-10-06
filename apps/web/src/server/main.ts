import { randomBytes } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, chmodSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { detectClaude, detectCodex } from '@centcom/agent';
import { findAppBrowser, openAsApp, openInBrowser } from './browsers.js';
import { ClientConfig, SessionStore } from '@centcom/tui';
import { Workspace } from './workspace.js';
import type { ClientMsg, DirEntry, Prefs, RecentDir, ServerMsg } from './protocol.js';

export const PORT = Number(process.env.CENTCOM_PORT ?? 58008);
const HOST = '127.0.0.1';
const HOME = homedir();
const STATE_DIR = join(HOME, '.centcom');
const DIST = resolve(dirname(fileURLToPath(import.meta.url)), '../../dist');
const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

/* ---------------------------------------------------------------- token: keeps other websites and local users out */
function loadToken(): string {
  mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
  const f = join(STATE_DIR, 'token');
  if (existsSync(f)) { const t = readFileSync(f, 'utf8').trim(); if (t.length >= 32) return t; }
  const t = randomBytes(24).toString('base64url'); writeFileSync(f, t, { mode: 0o600 }); try { chmodSync(f, 0o600); } catch { /* best effort on odd filesystems */ }
  return t;
}
const TOKEN = loadToken();
const hostOk = (h: string | undefined) => h === `${HOST}:${PORT}` || h === `localhost:${PORT}`;
const cookieTok = (c: string | undefined) => /(?:^|;\s*)centcom_t=([^;]+)/.exec(c ?? '')?.[1];

/* ---------------------------------------------------------------- recent directories */
const RECENT = join(STATE_DIR, 'recent.json');
function readRecent(): RecentDir[] { try { return (JSON.parse(readFileSync(RECENT, 'utf8')) as RecentDir[]).filter((r) => existsSync(r.dir)); } catch { return []; } }
function addRecent(dir: string) { const r = [{ dir, at: Date.now() }, ...readRecent().filter((x) => x.dir !== dir)].slice(0, 12); try { writeFileSync(RECENT, JSON.stringify(r)); } catch { /* not critical */ } }

function listDir(path: string): { path: string; parent: string | null; git: boolean; entries: DirEntry[]; error?: string } {
  const p = resolve(path || HOME); const parent = dirname(p) === p ? null : dirname(p);
  try {
    const entries: DirEntry[] = [];
    for (const name of readdirSync(p)) {
      if (name.startsWith('.') || name === 'node_modules') continue;
      try { if (statSync(join(p, name)).isDirectory()) entries.push({ name, git: existsSync(join(p, name, '.git')) }); } catch { /* unreadable entry */ }
    }
    entries.sort((a, b) => Number(b.git) - Number(a.git) || a.name.localeCompare(b.name));
    return { path: p, parent, git: existsSync(join(p, '.git')), entries: entries.slice(0, 400) };
  } catch (e) { return { path: p, parent, git: false, entries: [], error: (e as NodeJS.ErrnoException).code === 'EACCES' ? 'No permission to read this folder.' : 'Cannot read this folder.' }; }
}

/* ---------------------------------------------------------------- http */
const server = createServer((req, res) => {
  if (!hostOk(req.headers.host)) { res.writeHead(421).end('Wrong host'); return; }
  const url = new URL(req.url ?? '/', `http://${HOST}:${PORT}`);
  const headers: Record<string, string> = {
    'content-security-policy': `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws://${HOST}:${PORT} ws://localhost:${PORT}; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`,
    'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'cache-control': 'no-store',
  };
  const given = url.searchParams.get('t');
  if (given && given === TOKEN) { res.writeHead(302, { ...headers, location: url.pathname + (url.searchParams.has('open') ? `?open=${encodeURIComponent(url.searchParams.get('open')!)}${url.searchParams.get('demo') === '1' ? '&demo=1' : ''}${url.searchParams.get('engine') === 'codex' ? '&engine=codex' : ''}${url.searchParams.get('resume') ? '&resume=' + encodeURIComponent(url.searchParams.get('resume')!) : ''}` : ''), 'set-cookie': `centcom_t=${TOKEN}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000` }).end(); return; }
  if (cookieTok(req.headers.cookie) !== TOKEN) { res.writeHead(401, { ...headers, 'content-type': 'text/plain; charset=utf-8' }).end('Open Centcom with the link it printed in your terminal (it includes ?t=…).'); return; }
  let file = resolve(DIST, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
  if (file !== DIST && !file.startsWith(DIST + sep)) { res.writeHead(403, headers).end(); return; }
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html');
  if (!existsSync(file)) { res.writeHead(503, { ...headers, 'content-type': 'text/plain' }).end('The web client is not built yet. Run: pnpm web:build'); return; }
  res.writeHead(200, { ...headers, 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
});

/* ---------------------------------------------------------------- websocket */
const workspaces = new Map<string, Workspace>();
/** Choices that belong to the app itself, not to one project: theme, side panel, last agent. */
let appCfg: ClientConfig | undefined;
let appWarned = false;
const prefs = async (): Promise<Prefs> => { appCfg ??= await ClientConfig.load(process.cwd()); return { theme: appCfg.get('ui.theme') as Prefs['theme'], side: appCfg.get('client.side_panel') as boolean, engine: appCfg.get('client.engine') as Prefs['engine'] }; };
const savePref = async (m: { theme?: Prefs['theme']; side?: boolean }) => { await prefs(); if (m.theme && ['auto', 'dark', 'light'].includes(m.theme)) appCfg!.set('ui.theme', m.theme); if (typeof m.side === 'boolean') appCfg!.set('client.side_panel', m.side); };
const wss = new WebSocketServer({ noServer: true, maxPayload: 1_000_000 });
server.on('upgrade', (req, socket, head) => {
  const origin = req.headers.origin;
  const ok = hostOk(req.headers.host) && cookieTok(req.headers.cookie) === TOKEN && (origin === `http://${HOST}:${PORT}` || origin === `http://localhost:${PORT}`);
  if (!ok) { socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws));
});

wss.on('connection', (ws: WebSocket) => {
  const send = (m: ServerMsg) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m)); };
  let current: Workspace | undefined; let leave: (() => void) | undefined;
  const detach = () => { leave?.(); leave = undefined; current = undefined; };

  ws.on('close', detach);
  ws.on('message', async (raw) => {
    let m: ClientMsg; try { m = JSON.parse(String(raw)) as ClientMsg; } catch { return; }
    try {
      switch (m.t) {
        case 'hello': {
          const [st, cx] = await Promise.all([detectClaude(), detectCodex()]);
          send({ t: 'launcher', home: HOME, cwd: process.cwd(), recent: readRecent(), claude: { installed: st.installed, version: st.version, signedIn: st.signedIn, kind: st.loginKind }, codex: { installed: cx.installed, version: cx.version, signedIn: cx.signedIn, kind: cx.loginKind }, app: !!findAppBrowser(), prefs: await prefs() });
          if (appCfg && !appWarned) { appWarned = true; for (const w of appCfg.warnings) send({ t: 'notice', level: 'warn', text: 'Settings: ' + w }); } // a bad config file never blocks the launcher; say so once
          if (current) send({ t: 'opened', dir: current.dir, history: current.history() });
          break;
        }
        case 'browse': { const d = listDir(m.path); send({ t: 'dir', ...d, saved: new SessionStore().list(d.path, 50).length }); break; }
        case 'open': {
          const dir = resolve(m.dir); const key = `${dir}::${m.demo ? 'demo' : m.engine ?? 'claude-code'}`; // a second tab joins the running session, so resume only applies to a fresh one
          if (!existsSync(dir) || !statSync(dir).isDirectory()) { send({ t: 'notice', level: 'error', text: 'That folder does not exist.' }); break; }
          detach();
          let w = workspaces.get(key);
          if (!w) { w = await Workspace.open(dir, !!m.demo, m.engine === 'codex' ? 'codex' : 'claude-code', m.resume); workspaces.set(key, w); }
          addRecent(dir); current = w; send({ t: 'opened', dir, history: w.history() }); leave = w.join(send); // 'opened' first: the client resets its state on it, and join() sends the first snapshot
          break;
        }
        case 'launchApp': {
          const target = `http://${HOST}:${PORT}/?t=${TOKEN}` + (m.dir ? `&open=${encodeURIComponent(m.dir)}${m.demo ? '&demo=1' : ''}${m.engine === 'codex' ? '&engine=codex' : ''}${m.resume ? '&resume=' + encodeURIComponent(m.resume) : ''}` : '');
          if (!openAsApp(target)) send({ t: 'notice', level: 'warn', text: 'No Chrome, Chromium, Brave or Edge found for app mode. Opening in your browser instead.' }), openInBrowser(target);
          break;
        }
        case 'close': { if (current) { const w = current; detach(); w.close(); for (const [k, v] of workspaces) if (v === w) workspaces.delete(k); } send({ t: 'closed' }); break; }
        case 'submit': void current?.ctl.submit(String(m.text ?? '').slice(0, 100_000)); break;
        case 'approve': current?.ctl.answerApproval(m.decision === 'approve' ? 'approve' : 'deny', m.scope ?? 'once'); break;
        case 'interrupt': void current?.ctl.interrupt(); break;
        case 'setModel': current?.ctl.setModel(String(m.id ?? '')); break;
        case 'pref': await savePref(m); break;
        case 'cycleMode': current?.ctl.cycleMode(); break;
        case 'setMode': if (['default', 'acceptEdits', 'plan', 'bypassPermissions'].includes(m.mode)) current?.ctl.setMode(m.mode); break;
        case 'auto': current?.ctl.setSettings({ autoSkills: !!m.on }); break;
      }
    } catch (e) { send({ t: 'notice', level: 'error', text: e instanceof Error ? e.message : String(e) }); }
  });
});

/* ---------------------------------------------------------------- start */
const args = process.argv.slice(2);
server.on('error', (e: NodeJS.ErrnoException) => {
  if (e.code === 'EADDRINUSE') { console.error(`Port ${PORT} is already in use: Centcom is probably already running.\nOpen http://${HOST}:${PORT}/?t=${TOKEN}`); if (!args.includes('--no-open')) openInBrowser(`http://${HOST}:${PORT}/?t=${TOKEN}`); process.exit(0); }
  throw e;
});
server.listen(PORT, HOST, () => {
  const url = `http://${HOST}:${PORT}/?t=${TOKEN}`;
  console.log(`Centcom is running at http://${HOST}:${PORT}\nFirst visit from another browser: ${url}`);
  if (args.includes('--no-open')) return;
  if (args.includes('--app')) { if (!openAsApp(url)) openInBrowser(url); } else openInBrowser(url);
});
process.on('SIGINT', () => { appCfg?.flush(); for (const w of workspaces.values()) w.close(); process.exit(0); });
process.on('SIGTERM', () => { appCfg?.flush(); for (const w of workspaces.values()) w.close(); process.exit(0); });
