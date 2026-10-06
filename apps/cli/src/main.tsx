#!/usr/bin/env -S node --import tsx
import React from 'react';
import { execFileSync } from 'node:child_process';
import { render } from 'ink';
import { detectColorTier } from '@centcom/theme';
import { ClaudeCodeEngine, CodexEngine, DemoEngine, detectClaude, detectCodex, type AgentEngine, type PermissionMode } from '@centcom/agent';
import { App, AppController, ClientConfig, SessionStore, initialSettings, settingsFromConfig } from '@centcom/tui';
import type { FlatFlags } from '@centcom/config';
import { createAppLogger } from '@centcom/net';
import type { CentoColor } from '@centcom/mascot';
import { buildPrompt, readStdin, runPrint } from './print.js';
import { runProviderCli } from './commands/provider/cli.js';
import { makeMemoryFiles, runMemoryCli } from './commands/memory/cli.js';

const VERSION = '0.1.0';
const HELP = `centcom ${VERSION}: command many hands

Usage
  centcom [options]            start the terminal app in this directory
  centcom memory show|add|edit|status|sync   edit CLAUDE.md and AGENTS.md (a line starting with "# " in the app adds a note)
  centcom provider status|login|logout|doctor   check, sign in or out of Claude Code and Codex (the tools do the signing in)

Scripting
  centcom -p "task"             run once, print the answer, exit (no screen). Piped input is added to the prompt.
  --output-format <text|json|stream-json>   what -p prints (default text)
  cat error.log | centcom -p "what went wrong?"
  Anything that needs an approval is declined and reported (exit code 3); allow it with --mode acceptEdits or --dangerously-skip-permissions.
  Exit codes: 0 done, 1 error, 2 bad usage, 3 an action was declined.

Options
  --demo                       scripted demo agent (no login, no model)
  --engine <claude-code|codex|demo>  choose the agent engine (default: claude-code if installed)
  -c, --continue               continue the most recent conversation in this folder
  --resume <id>                continue a specific saved conversation (see /resume)
  --no-save                    do not save this conversation or your prompt history
  --model <name>               model to use (same ids as /model)
  --mode <default|plan|acceptEdits|bypassPermissions>  start in a permission mode
  --dangerously-skip-permissions   never ask: run commands and edit files freely (alias: --yolo)
  --mascot <large|small|off>   Cento size (default: auto from terminal height)
  --cento-color <violet|red|yellow|green|brown>
  --theme <dark|light>         Graphite (default) or Paper (for light terminals)
  --colors <truecolor|256|16|never>  force a colour tier (NO_COLOR is honoured)
  --demo-team                  with --demo: also show two pretend teammates (previews multiplayer)
  --debug                      write detailed logs to ~/.centcom/logs/centcom.log
  --no-motion                  turn animation off (also CENTCOM_REDUCED_MOTION=1; the older CENTCOM_REDUCE_MOTION works too)
  -v, --version   -h, --help

Centcom drives your own Claude Code; it never sees your login.`;

function arg(name: string): string | undefined { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; }
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
  let demo = has('--demo') || arg('--engine') === 'demo'; let note = '';
  const wantCodex = (arg('--engine') ?? preferred) === 'codex';
  if (wantCodex && !demo) { const cx = await detectCodex(); if (!cx.installed) { demo = true; note = 'Codex was not found, so this is the demo agent. Install Codex (npm i -g @openai/codex) and run `codex login`.'; } }
  if (!demo && !wantCodex) {
    const st = await detectClaude();
    if (!st.installed) { demo = true; note = 'Claude Code was not found, so this is the demo agent. Install Claude Code and sign in to use the real one.'; }
  }
  const engine: AgentEngine = demo ? new DemoEngine({ speed: 1 }) : wantCodex ? new CodexEngine() : new ClaudeCodeEngine();
  return { engine, demo, note };
}

async function main() {
  if (has('-h') || has('--help')) { console.log(HELP); return; }
  if (has('-v') || has('--version')) { console.log(VERSION); return; }
  if (process.argv[2] === 'provider') process.exit(await runProviderCli(process.argv.slice(3)));
  if (process.argv[2] === 'memory') process.exit(await runMemoryCli(process.argv.slice(3)));
  if (has('-p') || has('--print')) {
    const i = Math.max(process.argv.indexOf('-p'), process.argv.indexOf('--print'));
    const next = process.argv[i + 1]; const text = next && !next.startsWith('-') ? next : undefined;
    const piped = process.stdin.isTTY ? '' : await readStdin();
    const pc = await ClientConfig.load(process.cwd(), cliFlags());
    for (const w of pc.warnings) process.stderr.write('centcom: settings: ' + w + '\n');
    const { engine, demo, note } = await pickEngine(pc.cfg.client.engine); if (note) process.stderr.write(note + '\n');
    let br = ''; try { br = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { /* not a repo */ }
    const fmt = (arg('--output-format') ?? 'text') as 'text' | 'json' | 'stream-json';
    if (!['text', 'json', 'stream-json'].includes(fmt)) { process.stderr.write('--output-format must be text, json or stream-json\n'); process.exit(2); }
    const dangerous = has('--dangerously-skip-permissions') || has('--yolo');
    const code = await runPrint({ engine, demo, cwd: process.cwd(), branch: br, version: VERSION, mode: dangerous || arg('--mode') === 'bypassPermissions' ? 'bypassPermissions' : pc.cfg.client.permission_mode, prompt: buildPrompt(text, piped), format: fmt, save: !has('--no-save'), resume: has('-c') || has('--continue') ? 'last' : arg('--resume'), model: pc.cfg.client.model || undefined });
    process.exit(code);
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) { console.error('Centcom needs an interactive terminal. Try `centcom --help`.'); process.exit(2); }

  const cc = await ClientConfig.load(process.cwd(), cliFlags());
  const tier = detectColorTier({ env: process.env, isTTY: true, flag: cc.cfg.ui.color === 'auto' ? undefined : cc.cfg.ui.color });
  const { engine, demo, note } = await pickEngine(cc.cfg.client.engine);
  let branch = ''; try { branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { /* not a git repo */ }
  const dangerous = has('--dangerously-skip-permissions') || has('--yolo');
  const mode: PermissionMode = dangerous || arg('--mode') === 'bypassPermissions' ? 'bypassPermissions' : cc.cfg.client.permission_mode;
  const settings = { ...settingsFromConfig(cc.cfg), permissionMode: mode };
  if (arg('--engine') === 'codex' || arg('--engine') === 'claude-code') cc.set('client.engine', arg('--engine')!); // the agent you pick is the one you get next time

  const { logger } = createAppLogger({ level: cc.cfg.log.level, maxBytes: cc.cfg.log.max_file_bytes, maxFiles: cc.cfg.log.max_files });
  logger.info('app.start', { version: VERSION, engine: engine.id, demo, mode });
  let instance: ReturnType<typeof render> | undefined;
  const ctl = new AppController({
    engine, demo, cwd: process.cwd(), branch, version: VERSION, permissionMode: mode, dangerous: dangerous || mode === 'bypassPermissions', ghosts: has('--demo-team'),
    logger, settings, ...cc.options({ ...initialSettings(), ...settings }, { saveHistory: !has('--no-save') }),
    sessions: has('--no-save') ? undefined : new SessionStore(),
    resume: has('-c') || has('--continue') ? 'last' : arg('--resume'),
    onExit: () => instance?.unmount(),
    onMemoryAdd: async (text) => { // a line starting with "# " is a note for this tool's memory file (CLAUDE.md or AGENTS.md), shown as a diff and confirmed
      try { const mf = makeMemoryFiles(process.cwd()); const plan = await mf.plan({ engine: engine.id === 'codex' ? 'codex' : 'claude-code', scope: 'project', quickAdd: text, root: process.cwd() });
        return { diff: plan.diff || '(already there)', apply: async () => { await mf.apply(plan, { accepted: true, planHash: plan.planHash }); return 'Added to memory.'; } }; } catch (e) { return { error: String((e as Error).message ?? e) }; }
    },
  });
  process.stdout.write('\x1b[?1049h\x1b[2J\x1b[H'); // alternate screen: the transcript never pollutes scrollback
  const leave = () => process.stdout.write('\x1b[?1049l');
  process.on('exit', leave);
  await ctl.start();
  if (note) ctl.notice('warn', note);
  for (const w of cc.warnings) { ctl.notice('warn', 'Settings: ' + w); process.stderr.write('centcom: settings: ' + w + '\n'); }
  cc.onWarn = (w) => ctl.notice('warn', 'Settings: ' + w);
  if (mode === 'bypassPermissions') ctl.notice('warn', 'Dangerously skip permissions is ON', 'Cento will run commands and edit files without asking. Use /mode default to turn approvals back on.');
  instance = render(<App ctl={ctl} tier={tier} />, { exitOnCtrlC: false, patchConsole: false, maxFps: 30 });
  await instance.waitUntilExit();
  ctl.stop(); cc.flush();
  leave();
  process.exit(0);
}

main().catch((e) => { process.stdout.write('\x1b[?1049l'); console.error(e instanceof Error ? e.message : e); process.exit(1); });
