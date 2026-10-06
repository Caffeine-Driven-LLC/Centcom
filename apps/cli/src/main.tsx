#!/usr/bin/env -S node --import tsx
import React from 'react';
import { execFileSync } from 'node:child_process';
import { render } from 'ink';
import { detectColorTier } from '@centcom/theme';
import { ClaudeCodeEngine, CodexEngine, DemoEngine, detectClaude, detectCodex, type AgentEngine, type PermissionMode } from '@centcom/agent';
import { App, AppController } from '@centcom/tui';
import type { CentoColor } from '@centcom/mascot';

const VERSION = '0.1.0';
const HELP = `centcom ${VERSION}: command many hands

Usage
  centcom [options]            start the terminal app in this directory
  centcom provider status      show whether Claude Code and Codex are installed and signed in

Options
  --demo                       scripted demo agent (no login, no model)
  --engine <claude-code|codex|demo>  choose the agent engine (default: claude-code if installed)
  --mode <default|plan|acceptEdits|bypassPermissions>  start in a permission mode
  --dangerously-skip-permissions   never ask: run commands and edit files freely (alias: --yolo)
  --mascot <large|small|off>   Cento size (default: auto from terminal height)
  --cento-color <violet|red|yellow|green|brown>
  --theme <dark|light>         Graphite (default) or Paper (for light terminals)
  --colors <truecolor|256|16|never>  force a colour tier (NO_COLOR is honoured)
  --no-motion                  turn animation off (also CENTCOM_REDUCE_MOTION=1)
  -v, --version   -h, --help

Centcom drives your own Claude Code; it never sees your login.`;

function arg(name: string): string | undefined { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; }
const has = (n: string) => process.argv.includes(n);

async function main() {
  if (has('-h') || has('--help')) { console.log(HELP); return; }
  if (has('-v') || has('--version')) { console.log(VERSION); return; }
  if (process.argv[2] === 'provider') {
    const cx = await detectCodex();
    console.log(cx.installed ? `Codex ${cx.version ?? ''}  ${cx.signedIn === 'yes' ? `signed in (${cx.loginKind === 'subscription' ? 'ChatGPT' : cx.loginKind === 'api_key' ? 'API key' : 'unknown login type'}); a stale login only shows up when you send a message` : cx.signedIn === 'no' ? 'not signed in: run `codex login`' : 'sign-in status unknown'}` : 'Codex is not installed. See https://developers.openai.com/codex');
    const st = await detectClaude();
    console.log(st.installed ? `Claude Code ${st.version ?? ''}  ${st.signedIn === 'yes' ? `signed in (${st.loginKind === 'subscription' ? 'subscription' : st.loginKind === 'api_key' ? 'API key' : st.loginKind})` : st.signedIn === 'no' ? 'not signed in: run `claude auth login`' : 'sign-in status unknown'}` : 'Claude Code is not installed. See https://code.claude.com/docs');
    return;
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) { console.error('Centcom needs an interactive terminal. Try `centcom --help`.'); process.exit(2); }

  const tier = detectColorTier({ env: process.env, isTTY: true, flag: arg('--colors') });
  let engine: AgentEngine; let demo = has('--demo') || arg('--engine') === 'demo'; let note = '';
  const wantCodex = arg('--engine') === 'codex';
  if (wantCodex && !demo) { const cx = await detectCodex(); if (!cx.installed) { demo = true; note = 'Codex was not found, so this is the demo agent. Install Codex (npm i -g @openai/codex) and run `codex login`.'; } }
  if (!demo && !wantCodex) {
    const st = await detectClaude();
    if (!st.installed) { demo = true; note = 'Claude Code was not found, so this is the demo agent. Install Claude Code and sign in to use the real one.'; }
  }
  engine = demo ? new DemoEngine({ speed: 1 }) : wantCodex ? new CodexEngine() : new ClaudeCodeEngine();
  let branch = ''; try { branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { /* not a git repo */ }
  const dangerous = has('--dangerously-skip-permissions') || has('--yolo');
  const mode: PermissionMode = dangerous ? 'bypassPermissions' : (arg('--mode') as PermissionMode | undefined) ?? 'default';
  const reduced = has('--no-motion') || process.env.CENTCOM_REDUCE_MOTION === '1';

  let instance: ReturnType<typeof render> | undefined;
  const ctl = new AppController({
    engine, demo, cwd: process.cwd(), branch, version: VERSION, permissionMode: mode, dangerous: dangerous || mode === 'bypassPermissions', ghosts: demo,
    settings: { theme: arg('--theme') === 'light' ? 'light' : 'dark', reducedMotion: reduced, ...(arg('--mascot') ? { mascot: arg('--mascot') as 'large' } : {}), ...(arg('--cento-color') ? { color: arg('--cento-color') as CentoColor } : {}) },
    onExit: () => instance?.unmount(),
  });
  process.stdout.write('\x1b[?1049h\x1b[2J\x1b[H'); // alternate screen: the transcript never pollutes scrollback
  const leave = () => process.stdout.write('\x1b[?1049l');
  process.on('exit', leave);
  await ctl.start();
  if (note) ctl.notice('warn', note);
  if (mode === 'bypassPermissions') ctl.notice('warn', 'Dangerously skip permissions is ON', 'Cento will run commands and edit files without asking. Use /mode default to turn approvals back on.');
  instance = render(<App ctl={ctl} tier={tier} />, { exitOnCtrlC: false, patchConsole: false, maxFps: 30 });
  await instance.waitUntilExit();
  ctl.stop();
  leave();
  process.exit(0);
}

main().catch((e) => { process.stdout.write('\x1b[?1049l'); console.error(e instanceof Error ? e.message : e); process.exit(1); });
