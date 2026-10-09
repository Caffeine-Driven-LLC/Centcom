#!/usr/bin/env node
/** Renders the desktop app's screens in headless Chromium with a scripted stand-in for the desktop bridge, and writes PNGs, so the look of the GUI can be checked without Electron.
 *    node apps/web/scripts/gui-shots.mjs OUT_DIR [scene ...]     scenes: home, home-light, session, session-light, approval, busy, narrow
 *  Needs the Playwright Chromium (`pnpm exec playwright install chromium`) or PW_CHROMIUM=/path/to/chrome. */
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const out = process.argv[2] ?? '.'; const want = process.argv.slice(3); mkdirSync(out, { recursive: true });
const port = 5199; const base = `http://127.0.0.1:${port}`;
const vite = spawn('pnpm', ['exec', 'vite', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: new URL('..', import.meta.url).pathname, stdio: 'ignore' });
const stop = () => { try { vite.kill('SIGTERM'); } catch { /* gone */ } };
process.on('exit', stop); process.on('SIGINT', () => { stop(); process.exit(1); });
for (let i = 0; i < 100; i++) { try { if ((await fetch(base)).ok) break; } catch { /* not yet */ } await new Promise((r) => setTimeout(r, 300)); }

/** What the fake main process says (mirrors apps/desktop/src/local/protocol.ts). Plain data, so it can be handed to the page. */
const ts = Date.now(); const home = '/home/alex';
const tool = (id, name, summary, result, extra = {}) => ({ kind: 'tool', id, toolId: id, agentId: 'a', name, summary, risk: 'low', status: 'ok', result, ...extra });
const convo = [
  { kind: 'user', id: 'u1', text: 'The login test is failing after the session refactor. Find out why and fix it.', ts },
  { kind: 'thinking', id: 't1', done: true, ms: 1800, text: '' },
  { kind: 'assistant', id: 'a1', messageId: 'a1', agentId: 'a', text: "I'll start by looking at the failing test and the code it covers.", done: true },
  tool('k1', 'Read', 'test/auth/session.test.ts', '88 lines', { path: 'test/auth/session.test.ts' }),
  tool('k2', 'Grep', 'expiresAt in src/', '3 matches in 2 files'),
  { kind: 'assistant', id: 'a2', messageId: 'a2', agentId: 'a', done: true, text: 'Found it: `expiresAt` is in **seconds**, but `isExpired` compares it with `Date.now()` (milliseconds), so sessions look valid far too long.\n\n- `src/auth/session.ts` (line 41) is where it is compared\n- `src/auth/middleware.ts` and `src/api/refresh.ts` call it\n\nI will convert it to milliseconds in `isExpired`.' },
];
const diff = '--- a/src/auth/session.ts\n+++ b/src/auth/session.ts\n@@ -39,6 +39,8 @@\n export function isExpired(session: Session, now = Date.now()) {\n   if (!session.expiresAt) return false;\n-  return session.expiresAt < now;\n+  // expiresAt is in seconds; Date.now() is in milliseconds\n+  const expiresMs = session.expiresAt * 1000;\n+  return expiresMs <= now;\n }';
const pending = tool('k3', 'Edit', 'src/auth/session.ts', undefined, { path: 'src/auth/session.ts', status: 'running', risk: 'medium', approval: 'pending' });
const running = tool('k3', 'Grep', 'isExpired in src/', undefined, { status: 'running' });
const DATA = { home, convo, diff, pending, running };

const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const scenes = {
  home: { size: [1280, 800] }, 'home-light': { size: [1280, 800], theme: 'light' }, session: { size: [1280, 800], open: true }, 'session-light': { size: [1280, 800], open: true, theme: 'light' },
  approval: { size: [1280, 800], open: true, approval: true }, busy: { size: [1280, 800], open: true, busy: true }, narrow: { size: [760, 900], open: true },
};
for (const [name, o] of Object.entries(scenes)) {
  if (want.length && !want.includes(name)) continue;
  const ctx = await browser.newContext({ bypassCSP: true /* the dev server injects styles inline, which the page's CSP forbids */, viewport: { width: o.size[0], height: o.size[1] }, colorScheme: o.theme === 'light' ? 'light' : 'dark' }); const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('page error:', e.message.slice(0, 160)));
  await page.addInitScript(({ D, open, approval, busy, theme }) => {
    let cb = () => undefined; const push = (m) => setTimeout(() => cb(m), 0);
    const state = (x) => ({ busy: false, verb: '', branch: 'fix/session-expiry', engineLabel: 'Claude Code', settings: { permissionMode: 'default', model: '' }, approvals: [], agents: [], tasks: [], ...x });
    const openIt = () => {
      push({ t: 'opened', dir: D.home + '/projects/shop', history: [] }); push({ t: 'models', models: [{ id: 'claude-opus-5-5', label: 'Opus 5.5', note: 'hard problems', isDefault: true }, { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', note: 'everyday coding' }] });
      const items = D.convo.concat(approval ? [D.pending] : busy ? [D.running] : []);
      const ap = approval ? [{ id: 'ap1', tool: 'Edit', summary: 'src/auth/session.ts', risk: 'medium', path: 'src/auth/session.ts', diff: D.diff, agentName: 'you' }] : [];
      push({ t: 'state', state: state({ busy: !!busy || !!approval, verb: busy ? 'Conducting…' : '', approvals: ap }), changed: items, order: items.map((i) => i.id) });
    };
    window.centcom = { desktop: true, platform: 'linux', onLink() { return () => undefined; }, openExternal: async () => true, local: {
      onMessage(f) { cb = f; return () => undefined; },
      send(m) {
        if (m.t === 'hello') { push({ t: 'launcher', home: D.home, cwd: D.home + '/projects/shop', recent: [{ dir: D.home + '/projects/shop', at: Date.now() - 3600e3 }, { dir: D.home + '/projects/api', at: Date.now() - 86400e3 }, { dir: D.home + '/code/centcom', at: Date.now() - 4 * 86400e3 }], claude: { installed: true, version: '2.1.20', signedIn: 'yes', kind: 'subscription' }, codex: { installed: true, version: '0.161.0', signedIn: 'yes', kind: 'subscription' }, prefs: { theme: theme ?? 'auto', side: true, engine: 'claude-code' } }); if (open) openIt(); }
        if (m.t === 'browse') push({ t: 'dir', path: m.path, parent: D.home + '/projects', git: true, saved: 3, entries: [{ name: '.github', git: false }, { name: 'docs', git: false }, { name: 'src', git: false }, { name: 'test', git: false }] });
        if (m.t === 'open') openIt();
      } } };
  }, { D: DATA, open: !!o.open, approval: !!o.approval, busy: !!o.busy, theme: o.theme });
  if (o.theme === 'light') await page.addInitScript(() => { try { localStorage.setItem('cc-theme', 'light'); } catch { /* none */ } });
  await page.goto(`${base}/local`); await page.waitForTimeout(1500);
  await page.screenshot({ path: join(out, name + '.png') }); await ctx.close(); console.log('wrote', join(out, name + '.png'));
}
await browser.close(); stop();
