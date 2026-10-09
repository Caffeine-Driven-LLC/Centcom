#!/usr/bin/env -S node --import tsx
import React from 'react';
import { execFileSync } from 'node:child_process';
import { render } from 'ink';
import { detectColorTier } from '@centcom/theme';
import { ClaudeCodeEngine, CodexEngine, DemoEngine, detectClaude, detectCodex, type AgentEngine, type PermissionMode } from '@centcom/agent';
import { chooseEngine } from './engine-pick.js';
import { App, AppController, ClientConfig, FirstRun, SessionStore, TITLE_POP, TITLE_PUSH, resolveA11yMode, runLinear, queryBackground, buildRuntime, initialSettings, isFirstRun, markFirstRunDone, settingsFromConfig } from '@centcom/tui';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename as pathBase, join as pathJoin, resolve as pathResolve } from 'node:path';
import { homedir } from 'node:os';
import { stateDir } from '@centcom/config';
import type { FlatFlags } from '@centcom/config';
import { createAppLogger } from '@centcom/net';
import type { CentoColor } from '@centcom/mascot';
import { buildPrompt, readStdin, runPrint } from './print/index.js';
import { chooseSession, pickSession } from './commands/resume.js';
import { runProviderCli } from './commands/provider/cli.js';
import { makeMemoryFiles, runMemoryCli } from './commands/memory/cli.js';
import { appViews } from './views.js';
import { runInitCli } from './commands/init.js';
import { resolvedKeys, runKeys } from './commands/keys.js';
import { runSkills, ttyAsk } from './commands/skills.js';
import { runLanCli } from './commands/lan/scan.js';
import { CrashStore, installCrashHandlers, runCrash } from './crash/index.js';
import { realDoctorContext, runDoctor } from './doctor/index.js';
import { CONTRACT_VERSION } from '@centcom/protocol';
import { find as findCommand, helpFor, renderHelp, topHelp } from './help/index.js';
import { COMMANDS } from './help/commands.js';
import { checkArgs, normalizeArgs } from './flags.js';
import { becomesForeground, editInEditor, stopUntilContinued, type ExternalTask } from './external.js';
import { runUpdate } from './commands/update/index.js';
import { bootUpdate } from './bootUpdate.js';
import { createInterface } from 'node:readline';
import { dirname as pathDirname } from 'node:path';
import { PRODUCTION_KEYS, UpdateClient, createHttpClient, defaultUserAgent } from '@centcom/net';
import { makeTelemetry, runTelemetry } from './commands/telemetry.js';
import { defaultDeps, loadConfig } from '@centcom/config';
import { runMcpCli } from './commands/mcp/cli.js';
import { runHooksCli } from './commands/hooks/cli.js';
import { runAccountCli } from './commands/account/cli.js';
import { ACCOUNT_COMMANDS } from './commands/account/index.js';

const VERSION = '0.1.0';
const HELP = topHelp(VERSION);

/** The word after an option, unless that is another option (`--resume --demo` has no id). */
function arg(name: string): string | undefined { const i = process.argv.indexOf(name); const v = i >= 0 ? process.argv[i + 1] : undefined; return v !== undefined && v.startsWith('-') && !/^-\d/.test(v) ? undefined : v; }
const has = (n: string) => process.argv.includes(n);

/** Explicit command-line choices, as the top config layer. They are used for this run and never written back. */
function cliFlags(): FlatFlags {
  const f: FlatFlags = {}; const v = (n: string) => arg(n);
  if (v('--theme')) f['ui.theme'] = v('--theme')!; if (v('--mascot')) f['client.mascot_size'] = v('--mascot')!; if (v('--cento-color')) f['client.cento_color'] = v('--cento-color')!;
  if (v('--model')) f['client.model'] = v('--model')!; if (v('--colors')) f['ui.color'] = v('--colors') === 'never' ? 'never' : v('--colors')!;
  if (v('--mode') && v('--mode') !== 'bypassPermissions') f['client.permission_mode'] = v('--mode')!;
  if (v('--engine') === 'codex' || v('--engine') === 'claude-code') f['client.engine'] = v('--engine')!;
  if (has('--no-motion')) f['ui.reduced_motion'] = true;
  if (has('--debug')) f['log.level'] = 'debug';
  return f;
}

async function pickEngine(preferred: 'claude-code' | 'codex' = 'claude-code'): Promise<{ engine: AgentEngine; demo: boolean; note: string }> {
  const explicit = arg('--engine') === 'codex' || arg('--engine') === 'claude-code' ? (arg('--engine') as 'codex' | 'claude-code') : undefined;
  const pick = await chooseEngine({ demo: has('--demo') || arg('--engine') === 'demo', explicit, preferred, installed: async (e) => (e === 'codex' ? await detectCodex() : await detectClaude()).installed });
  const engine: AgentEngine = pick.engine === 'demo' ? new DemoEngine({ speed: 1 }) : pick.engine === 'codex' ? new CodexEngine() : new ClaudeCodeEngine();
  return { engine, demo: pick.engine === 'demo', note: pick.note };
}

const screenReaderRequested = () => process.argv.includes('--screen-reader') || /^(1|true|on|yes)$/i.test(process.env.CENTO_SCREEN_READER ?? '');
async function main() {
  // `centcom help [topic]` and `centcom <command> --help` come from the same list as the docs and the man pages
  const helpOpts = { width: Math.min(80, process.stdout.columns ?? 80), colour: !!process.stdout.isTTY && !process.env.NO_COLOR };
  if (process.argv[2] === 'help') { const r = helpFor(process.argv[3], helpOpts); (r.code ? console.error : console.log)(r.text); process.exit(r.code); }
  if ((has('--help') || has('-h')) && process.argv[2] && findCommand(process.argv[2]) && process.argv[2] !== 'centcom') { console.log(renderHelp(findCommand(process.argv[2])!, helpOpts)); process.exit(0); }
  if (has('-h') || has('--help')) { console.log(HELP); return; }
  if (has('-v') || has('--version')) { console.log(VERSION); return; }
  if (process.argv[2] === 'telemetry') process.exit(await runTelemetry(process.argv.slice(3), { out: (l) => console.log(l), err: (l) => console.error(l), version: VERSION }));
  // anonymous counts of which command ran, only when you turned telemetry on (docs/telemetry.md)
  const cfg0 = await loadConfig(defaultDeps()).catch(() => undefined); const tm = makeTelemetry({ enabled: !!cfg0?.telemetry.enabled, baseUrl: cfg0?.api.base_url ?? 'https://api.centcom.dev', version: VERSION });
  const isAccount = (ACCOUNT_COMMANDS as readonly string[]).includes(process.argv[2] ?? '');
  const sub = ['provider', 'memory', 'mcp', 'hooks', 'init', 'keys', 'skills', 'lan', 'doctor', 'crash', 'update'].includes(process.argv[2] ?? '') || isAccount ? process.argv[2]! : has('-p') || has('--print') ? 'print' : 'tui'; tm.appStart(); tm.commandRun(sub);
  const done = async (code: number) => { tm.appExit(); await tm.flush(2000); process.exit(code); };
  // anything nobody caught is written (redacted) to ~/.centcom/crashes and never sent anywhere
  const crashes = new CrashStore(stateDir(defaultDeps()));
  installCrashHandlers({ store: crashes, proc: process as never, info: { version: VERSION, contract: CONTRACT_VERSION, platform: `${process.platform}-${process.arch}`, node: process.version, now: () => Date.now(), scrub: { home: homedir(), deny: [pathBase(process.cwd())] } }, recentLog: () => [], err: (l) => console.error(l), onCode: (code) => tm.errorShown(code as never) });
  if (process.argv[2] === 'crash') await done(runCrash(process.argv.slice(3), crashes, { out: (l) => console.log(l), err: (l) => console.error(l) }));
  if (process.argv[2] === 'doctor') await done(await runDoctor(process.argv.slice(3), realDoctorContext({ version: VERSION, contract: CONTRACT_VERSION, apiBase: cfg0?.api.base_url ?? 'https://api.centcom.dev', stateDir: stateDir(defaultDeps()) }), { out: (l) => console.log(l), err: (l) => console.error(l) }, { crashes }));
  if (process.argv[2] === 'provider') await done(await runProviderCli(process.argv.slice(3)));
  if (process.argv[2] === 'skills') await done(await runSkills(process.argv.slice(3), { out: (l) => console.log(l), err: (l) => console.error(l), ask: ttyAsk, cwd: process.cwd() }));
  if (process.argv[2] === 'update') {
    const base = cfg0?.api.base_url ?? 'https://api.centcom.dev'; const http = createHttpClient({ baseUrl: base, getAccessToken: async () => undefined, userAgent: defaultUserAgent(VERSION) });
    await done(await runUpdate(process.argv.slice(3), { version: VERSION, defaultChannel: (cfg0?.update?.channel ?? 'stable') as 'stable' | 'beta' | 'nightly', client: (channel) => new UpdateClient({ http, currentVersion: VERSION, platform: process.platform, arch: process.arch, channel, keys: PRODUCTION_KEYS, installDir: pathDirname(process.execPath), install: { execPath: process.execPath, scriptPath: process.argv[1] } }) }, { out: (l) => console.log(l), err: (l) => console.error(l), progress: (p) => { if (process.stdout.isTTY) process.stdout.write(`\r${Math.round((p.received / p.total) * 100)}%`); }, confirm: (q) => new Promise((res) => { const rl = createInterface({ input: process.stdin, output: process.stdout }); rl.question(q, (a) => { rl.close(); res(/^y(es)?$/i.test(a.trim())); }); }) }));
  }
  if (process.argv[2] === 'keys') await done(runKeys(process.argv.slice(3), { out: (l) => console.log(l), err: (l) => console.error(l) }));
  if (process.argv[2] === 'init') await done(await runInitCli(process.argv.slice(3)));
  if (process.argv[2] === 'memory') await done(await runMemoryCli(process.argv.slice(3)));
  if (process.argv[2] === 'mcp') await done(await runMcpCli(process.argv.slice(3)));
  if (process.argv[2] === 'hooks') await done(await runHooksCli(process.argv.slice(3)));
  if (isAccount) await done(await runAccountCli(process.argv[2]!, process.argv.slice(3).filter((a) => a !== '--debug'), { version: VERSION }));
  if (process.argv[2] === 'lan') { await done(await runLanCli(process.argv.slice(3), { out: (l) => console.log(l), err: (l) => console.error(l) })); }
  { // the terminal app and print mode take only the options in the help: a typo is a clear message, not a silent no-op
    const top = findCommand('centcom')!; process.argv.splice(2, process.argv.length - 2, ...normalizeArgs(process.argv.slice(2), top.flags));
    const bad = checkArgs(process.argv.slice(2), top.flags, { print: has('-p') || has('--print'), commands: [...COMMANDS.map((c) => c.name).filter((n) => n !== 'centcom'), 'help'] });
    if (bad) { process.stderr.write(bad + '\n'); process.exit(2); }
  }
  if (has('-p') || has('--print')) {
    const i = Math.max(process.argv.indexOf('-p'), process.argv.indexOf('--print'));
    const next = process.argv[i + 1]; const text = next && !next.startsWith('-') ? next : undefined;
    const usage = (m: string) => { process.stderr.write(m + '\n'); process.exit(2); };
    let piped = ''; if (!process.stdin.isTTY) { try { piped = await readStdin(); } catch (e) { usage(String((e as Error).message)); } }
    if (!text && !piped.trim()) usage('Give Centcom something to do: centcom -p "your task" (or pipe text in).');
    const cwd = arg('--cwd') ? pathResolve(arg('--cwd')!) : process.cwd(); if (arg('--cwd')) { try { process.chdir(cwd); } catch { usage(`--cwd: no such folder: ${arg('--cwd')}`); } }
    const pc = await ClientConfig.load(cwd, cliFlags());
    for (const w of pc.warnings) process.stderr.write('centcom: settings: ' + w + '\n');
    const eng = arg('--engine'); if (eng && !['claude-code', 'codex', 'demo'].includes(eng)) usage('--engine must be claude-code or codex');
    const { engine, demo, note } = await pickEngine(pc.cfg.client.engine);
    if (demo && !has('--demo') && eng !== 'demo') { process.stderr.write((note || 'No coding agent is installed.') + '\n'); process.exit(4); } // scripts get a clear failure, never the demo agent
    let br = ''; try { br = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { /* not a repo */ }
    const fmt = (arg('--output-format') ?? 'text') as 'text' | 'json' | 'stream-json';
    if (!['text', 'json', 'stream-json'].includes(fmt)) usage('--output-format must be text, json or stream-json');
    const pm = arg('--permission-mode'); const modes: Record<string, PermissionMode> = { ask: 'default', 'accept-edits': 'acceptEdits', plan: 'plan', default: 'default', acceptEdits: 'acceptEdits' };
    if (pm && !modes[pm]) usage('--permission-mode must be ask, accept-edits or plan');
    const num = (name: string) => { const v = arg(name); if (v === undefined) return undefined; const n = Number(v); if (!Number.isFinite(n) || n <= 0) usage(`${name} must be a positive number`); return n; };
    const allow = process.argv.flatMap((a, k) => (a === '--allow' && process.argv[k + 1] ? [process.argv[k + 1]!] : []));
    const dangerous = has('--dangerously-skip-permissions') || has('--yolo');
    let resume = arg('--resume');
    if (has('-c') || has('--continue')) { const c = chooseSession(new SessionStore(), { cwd, continue: true }); if ('exit' in c) { process.stderr.write(c.message + '\n'); process.exit(c.exit); } if ('id' in c) resume = c.id; }
    const code = await runPrint({ engine, demo, cwd, branch: br, version: VERSION, mode: dangerous || arg('--mode') === 'bypassPermissions' ? 'bypassPermissions' : pm ? modes[pm]! : pc.cfg.client.permission_mode, prompt: buildPrompt(text, piped), format: fmt, save: !has('--no-save'), resume, model: arg('--model') ?? (pc.cfg.client.model || undefined), allow, timeoutS: num('--timeout'), maxTurns: num('--max-turns') });
    await done(code);
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) { console.error('Centcom needs an interactive terminal. Try `centcom --help`.'); process.exit(2); }

  const cc = await ClientConfig.load(process.cwd(), cliFlags());
  const tier = detectColorTier({ env: process.env, isTTY: true, flag: cc.cfg.ui.color === 'auto' ? undefined : cc.cfg.ui.color });
  const { engine, demo, note } = await pickEngine(cc.cfg.client.engine);
  let branch = ''; try { branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { /* not a git repo */ }
  const dangerous = has('--dangerously-skip-permissions') || has('--yolo');
  const mode: PermissionMode = dangerous || arg('--mode') === 'bypassPermissions' ? 'bypassPermissions' : cc.cfg.client.permission_mode;
  const a11y = resolveA11yMode({ env: process.env, flags: { screenReader: has('--screen-reader') }, config: { screenReader: cc.cfg.a11y.screen_reader, reducedMotion: cc.cfg.ui.reduced_motion } });
  const settings = { ...settingsFromConfig(cc.cfg), permissionMode: mode, reducedMotion: a11y.reducedMotion, ...(a11y.screenReader ? { mascot: 'off' as const } : {}) };
  // theme "auto": ask the terminal for its background colour (150 ms at most, nothing is written without a terminal) so a light terminal gets Paper instead of Graphite
  if (cc.cfg.ui.theme === 'auto' && !a11y.screenReader) { const bg = await queryBackground({ out: process.stdout, inp: process.stdin }); if (bg === 'light') settings.theme = 'light'; }
  let pendingExternal: ExternalTask | undefined; // set by ctrl+z and ctrl+g: the screen steps aside, the task runs, the screen comes back
  let quitLinear: () => void = () => undefined; const linearStop = new Promise<void>((r) => { quitLinear = r; });
  if (arg('--engine') === 'codex' || arg('--engine') === 'claude-code') cc.set('client.engine', arg('--engine')!); // the agent you pick is the one you get next time

  const { logger } = createAppLogger({ level: cc.cfg.log.level, maxBytes: cc.cfg.log.max_file_bytes, maxFiles: cc.cfg.log.max_files });
  logger.info('app.start', { version: VERSION, engine: engine.id, demo, mode });
  let instance: ReturnType<typeof render> | undefined;
  const rt = await buildRuntime({ cwd: process.cwd(), engineId: engine.id, demo, dangerous: dangerous || mode === 'bypassPermissions', checkpoints: !has('--no-checkpoints'), approvalTimeoutMs: cc.cfg.agent.approval_timeout_ms, sessionUsd: cfg0?.budget?.session_usd || undefined, stateDir: stateDir(defaultDeps()) });
  // --continue / --resume [id]: decided before the screen starts, so a wrong id is one line and exit 1
  const sessionStore = has('--no-save') ? undefined : new SessionStore(); let resumeId: string | undefined;
  if (sessionStore && (has('-c') || has('--continue') || has('--resume'))) {
    const c = chooseSession(sessionStore, { cwd: process.cwd(), continue: has('-c') || has('--continue'), resume: has('--resume'), id: arg('--resume') });
    if ('exit' in c) { if (c.message) process.stderr.write(c.message + '\n'); if (c.exit) process.exit(c.exit); }
    else if ('pick' in c) { resumeId = await pickSession(c.pick, { input: process.stdin, output: process.stdout }); if (!resumeId) process.exit(0); }
    else resumeId = c.id;
  }
  const ctl = new AppController({ ...rt.options, views: appViews(process.cwd(), { doctor: () => realDoctorContext({ version: VERSION, contract: CONTRACT_VERSION, apiBase: cc.cfg.api.base_url, stateDir: stateDir(defaultDeps()) }) }),
    engine, demo, cwd: process.cwd(), branch, version: VERSION, permissionMode: mode, dangerous: dangerous || mode === 'bypassPermissions', ghosts: has('--demo-team'),
    logger, settings, external: (task) => { pendingExternal = task; instance?.unmount(); }, bell: () => { try { process.stdout.write('\x07'); } catch { /* no terminal */ } }, ...cc.options({ ...initialSettings(), ...settings }, { saveHistory: !has('--no-save') }),
    sessions: sessionStore, night: demo ? undefined : { dir: pathJoin(homedir(), '.centcom', 'night') },
    modelCache: { read: async (f) => { try { return await readFile(pathJoin(stateDir(defaultDeps()), f), 'utf8'); } catch { return undefined; } }, write: async (f, t) => { const d = stateDir(defaultDeps()); await mkdir(d, { recursive: true, mode: 0o700 }); await writeFile(pathJoin(d, f), t, { mode: 0o600 }); } },
    resume: resumeId,
    onExit: (code) => { if (code) process.exitCode = code; instance?.unmount(); quitLinear(); },
    onMemoryAdd: async (text) => { // a line starting with "# " is a note for this tool's memory file (CLAUDE.md or AGENTS.md), shown as a diff and confirmed
      try { const mf = makeMemoryFiles(process.cwd()); const plan = await mf.plan({ engine: engine.id === 'codex' ? 'codex' : 'claude-code', scope: 'project', quickAdd: text, root: process.cwd() });
        return { diff: plan.diff || '(already there)', apply: async () => { await mf.apply(plan, { accepted: true, planHash: plan.planHash }); return 'Added to memory.'; } }; } catch (e) { return { error: String((e as Error).message ?? e) }; }
    },
  });
  let titlePushed = false; // the tab title is saved once, when the app first sets it, and put back when the terminal is given back
  if (!a11y.screenReader) { process.stdout.write(TITLE_PUSH); titlePushed = true; } // the old title is saved always (the title can be switched on later) and comes back on exit
  if (!a11y.screenReader) process.stdout.write('\x1b[?1049h\x1b[2J\x1b[H'); // alternate screen: the transcript never pollutes scrollback (a screen reader gets plain appended lines instead)
  // the one-time welcome, before anything else (never in print mode or without a terminal)
  const firstRunFile = pathJoin(stateDir({ env: process.env, homedir: homedir() }), 'state.json'); let firstRunNote: string | undefined;
  if (!a11y.screenReader && !has('--demo') && await isFirstRun({ stateFile: firstRunFile })) {
    await new Promise<void>((done) => { const fr = render(<FirstRun onDone={() => { fr.unmount(); done(); }} width={process.stdout.columns ?? 80} height={process.stdout.rows ?? 24} tier={tier} mascotAllowed={settings.mascot !== 'off'} reducedMotion={settings.reducedMotion} color={settings.color} theme={settings.theme} />, { exitOnCtrlC: true, patchConsole: false }); });
    const r = await markFirstRunDone({ stateFile: firstRunFile }); if (!r.ok) firstRunNote = r.message; process.stdout.write('\x1b[2J\x1b[H');
  }
  /** Put the terminal back as it was: out of the alternate screen, mouse reporting off, cursor shown. Safe to call twice. */
  const leave = () => { if (a11y.screenReader) return; /* plain-text mode never wrote a control code, so it takes none back */ try { process.stdout.write('\x1b[?1000l\x1b[?1006l\x1b[?25h\x1b[?1049l' + (titlePushed ? TITLE_POP : '')); titlePushed = false; } catch { /* the terminal is gone */ } };
  process.on('exit', leave);
  for (const [sig, code] of [['SIGTERM', 143], ['SIGHUP', 129]] as const) process.on(sig, () => { leave(); process.exit(code); }); // `kill` and a closing window must not leave your shell in the alternate screen with the mouse captured
  rt.bind(ctl);
  await ctl.start();
  { // every start: look for a newer release in the background and bring it in, so the next start is the latest (never delays this one)
    const http = createHttpClient({ baseUrl: cc.cfg.api.base_url, getAccessToken: async () => undefined, userAgent: defaultUserAgent(VERSION) });
    const client = new UpdateClient({ http, currentVersion: VERSION, platform: process.platform, arch: process.arch, channel: cc.cfg.update.channel, keys: PRODUCTION_KEYS, installDir: pathDirname(process.execPath), install: { execPath: process.execPath, scriptPath: process.argv[1] } });
    void bootUpdate({ client, env: process.env, version: VERSION, check: cc.cfg.update.check && !demo, auto: cc.cfg.update.auto, say: (level, text, detail) => { logger.info('update', { text }); ctl.notice(level, text, detail); } }).catch(() => undefined);
  }
  if (note) ctl.notice('warn', note);
  for (const w of rt.warnings) ctl.notice('warn', w);
  if (firstRunNote) ctl.notice('warn', firstRunNote);
  for (const w of cc.warnings) { ctl.notice('warn', 'Settings: ' + w); process.stderr.write('centcom: settings: ' + w + '\n'); }
  cc.onWarn = (w) => ctl.notice('warn', 'Settings: ' + w);
  if (mode === 'bypassPermissions') ctl.notice('warn', 'Dangerously skip permissions is ON', 'Cento will run commands and edit files without asking. Use /mode default to turn approvals back on.');
  const keys = resolvedKeys(); if (keys.warnings.length) ctl.notice('warn', `Some of your key bindings were skipped (${keys.warnings.length}). Press ? to see why.`);
  // A resize: once it settles, forget what Ink thinks is on screen, clear it and draw the whole frame again. Ink only wipes on a narrower window (by moving the cursor up), which leaves stale rows or borders when the window grows or its height changes.
  let resizeTimer: NodeJS.Timeout | undefined;
  if (!a11y.screenReader && process.stdout.isTTY) process.stdout.on('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (!instance || pendingExternal) return; instance.clear(); process.stdout.write('\x1b[2J\x1b[H'); instance.rerender(<App ctl={ctl} tier={tier} keys={keys} />); }, 90); resizeTimer.unref();
  });
  if (a11y.screenReader) await runLinear(ctl, { input: process.stdin, output: process.stdout }, linearStop);
  else {
    for (;;) { // each pass draws the app; a task (your editor, being put in the background) unmounts it, runs on the real terminal, and the loop draws it again from the same state
      instance = render(<App ctl={ctl} tier={tier} keys={keys} />, { exitOnCtrlC: false, patchConsole: false, maxFps: 30, incrementalRendering: !process.env.CENTCOM_FULL_RENDER });
      await instance.waitUntilExit(); const task = pendingExternal; pendingExternal = undefined; if (!task) break;
      process.stdout.write('\x1b[?1000l\x1b[?1006l\x1b[?25h\x1b[?1049l'); // the screen is the shell's again
      if (task.kind === 'editor') task.done(editInEditor(task.text)); else { for (;;) { await stopUntilContinued(); if (await becomesForeground()) break; } } // `bg` wakes the job without the terminal: it goes back to sleep until `fg` (a moment is allowed for the shell to hand the terminal over)
      process.stdout.write('\x1b[?1049h\x1b[2J\x1b[H');
    }
  }
  ctl.stop(); await ctl.stopFleet(); cc.flush();
  leave();
  await done(0);
}

main().catch((e) => { if (!screenReaderRequested()) process.stdout.write('\x1b[?1049l'); console.error(e instanceof Error ? e.message : e); process.exit(1); });
