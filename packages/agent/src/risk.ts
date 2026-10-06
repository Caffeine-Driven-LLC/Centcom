import type { Risk } from './types.js';

/** Fail-closed command risk classification for the approval UI (lane C016, simplified). Unknown = medium. */
const HIGH = [/\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r|--recursive)/, /\bsudo\b/, /\bmkfs\b/, /\bdd\s+if=/, /\bgit\s+push\b.*(--force|-f\b)/, /\bgit\s+reset\s+--hard/, /\bchmod\s+-R\b/, /\|\s*(sh|bash|zsh)\b/, /\bcurl\b.*\|\s*\w*sh/, />\s*\/dev\/(sd|nvme)/, /:\(\)\s*\{/, /\bgit\s+clean\s+-[a-z]*f/];
const LOW = [/^\s*(ls|pwd|cat|head|tail|wc|echo|which|whoami|date|env|printenv|tree|stat|file|du|df)\b/, /^\s*git\s+(status|log|diff|show|branch|remote|rev-parse|blame)\b/, /^\s*(rg|grep|find|fd)\b/, /^\s*(node|python3?|tsc|npx\s+tsc)\s+(-v|--version)\b/];

export function classifyCommand(command: string): Risk {
  const c = command.trim();
  if (!c) return 'medium';
  if (HIGH.some((r) => r.test(c))) return 'high';
  const parts = c.split(/&&|\|\||;|\n/).map((s) => s.trim()).filter(Boolean);
  if (parts.length && parts.every((p) => LOW.some((r) => r.test(p)) && !/[`$(]/.test(p))) return 'low';
  return 'medium';
}

/** Tools that only read are low risk; writes are medium; unknown tools are medium. */
export function classifyTool(name: string, input?: Record<string, unknown>): Risk {
  const n = name.toLowerCase();
  if (['read', 'glob', 'grep', 'ls', 'websearch', 'webfetch', 'todowrite', 'task', 'notebookread'].includes(n)) return 'low';
  if (n === 'bash' && typeof input?.command === 'string') return classifyCommand(input.command);
  if (['edit', 'write', 'multiedit', 'notebookedit'].includes(n)) return 'medium';
  return 'medium';
}
