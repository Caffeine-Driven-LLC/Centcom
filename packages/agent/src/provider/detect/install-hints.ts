import type { EngineId } from '../../types.js';
/** Text only: Centcom never runs an installer. */
export function installHint(engine: EngineId, os: NodeJS.Platform = process.platform): string {
  if (engine === 'codex') return os === 'darwin' ? 'Install Codex with `npm install -g @openai/codex` or `brew install codex`.' : os === 'win32' ? 'Install Codex with `npm install -g @openai/codex` in PowerShell.' : 'Install Codex with `npm install -g @openai/codex`.';
  if (engine === 'claude-code') return os === 'win32' ? 'Install Claude Code with `npm install -g @anthropic-ai/claude-code` in PowerShell, or use the installer from its documentation page.' : 'Install Claude Code with `npm install -g @anthropic-ai/claude-code`, or use the installer from its documentation page.';
  return 'Install the command-line tool, then run `centcom provider status`.';
}
export const DOCS_URL: Record<string, string> = { 'claude-code': 'https://code.claude.com/docs', codex: 'https://developers.openai.com/codex' };
export const commandName = (e: EngineId): string => (e === 'claude-code' ? 'claude' : e === 'codex' ? 'codex' : String(e));
export const manualLogin = (e: EngineId): string => (e === 'codex' ? 'codex login' : 'claude auth login');
export const manualLogout = (e: EngineId): string => (e === 'codex' ? 'codex logout' : 'claude auth logout');
