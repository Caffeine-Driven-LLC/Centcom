import { looksLikeSecret } from '@centcom/protocol';
import { McpError, McpSecretRejected } from './errors.js';

export type McpTransport = 'stdio' | 'http' | 'sse';
/** The neutral definition of one MCP server. Values are never secrets: environment variables are only named. */
export interface McpServerDef {
  name: string; transport: McpTransport; command?: string; args?: string[]; url?: string;
  /** ENV NAME seen by the server -> name of the variable that holds the value in your environment. */
  env_refs?: Record<string, string>; /** HTTP header -> name of the variable that holds its value. */ header_refs?: Record<string, string>;
  /** Plain, non-secret settings (for example LOG_LEVEL). Anything that looks like a secret is refused. */ env?: Record<string, string>;
}
export const BUILTIN_NAME = 'centcom-approvals';
export const BUILTIN: McpServerDef = { name: BUILTIN_NAME, transport: 'stdio', command: 'centcom-approvals' };
/** The contract's secret list has no GitHub, Slack, Stripe or npm tokens; MCP configs are where these most often get pasted, so they are caught here as well. */
const EXTRA_SECRETS = [/\bgh[pousr]_[A-Za-z0-9]{30,}/, /\bgithub_pat_[A-Za-z0-9_]{30,}/, /\bxox[baprs]-[A-Za-z0-9-]{10,}/, /\b[sr]k_live_[A-Za-z0-9]{20,}/, /\bnpm_[A-Za-z0-9]{30,}/, /\bglpat-[A-Za-z0-9_-]{20,}/];
const isSecret = (t: string) => looksLikeSecret(t) || /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(t) || EXTRA_SECRETS.some((r) => r.test(t));
const NAME = /^[a-z][a-z0-9_-]{0,31}$/; const VAR = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/; const SECRET_KEY = /token|secret|password|passwd|api[_-]?key|credential|private/i;
export const isLoopbackUrl = (u: URL) => u.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname);
/** https anywhere, or http only to this computer. */
export function urlAllowed(raw: string): boolean { try { const u = new URL(raw); return u.protocol === 'https:' || isLoopbackUrl(u); } catch { return false; } }

export function validateDef(d: McpServerDef): void {
  const bad = (m: string) => { throw new McpError('invalid_server', m); };
  if (typeof d?.name !== 'string' || !NAME.test(d.name)) bad('A server name is lowercase letters, digits, - and _, starting with a letter (32 at most).');
  if (d.transport !== 'stdio' && d.transport !== 'http' && d.transport !== 'sse') bad('The transport is stdio, http or sse.');
  if (d.transport === 'stdio') { if (typeof d.command !== 'string' || !d.command.trim() || /[\r\n\0]/.test(d.command)) bad('A stdio server needs a command.'); if (d.url !== undefined) bad('A stdio server has no URL.'); }
  else { if (typeof d.url !== 'string' || !urlAllowed(d.url)) bad('The URL has to be https, or http to this computer.'); if (d.command !== undefined) bad('A network server has no command.'); }
  if (d.args !== undefined && (!Array.isArray(d.args) || d.args.some((a) => typeof a !== 'string' || a.includes('\0')) || d.args.length > 100)) bad('The arguments have to be a list of text.');
  for (const [k, v] of Object.entries(d.env ?? {})) { if (!VAR.test(k) || typeof v !== 'string') bad('A setting is NAME -> text.'); if (SECRET_KEY.test(k) && !/^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/.test(v)) throw new McpSecretRejected(); }
  // everything that could end up in a file is scanned, including the "names" in references: a pasted token is not a variable name
  const texts = [d.command ?? '', d.url ?? '', ...(d.args ?? []), ...Object.values(d.env ?? {}), ...Object.entries(d.env_refs ?? {}).flat(), ...Object.entries(d.header_refs ?? {}).flat(), ...Object.keys(d.env ?? {})]; if (texts.some(isSecret)) throw new McpSecretRejected();
  if (d.url && /^[a-z]+:\/\/[^/]*:[^/@]*@/i.test(d.url)) throw new McpSecretRejected(); // a password inside the URL
  for (const [k, v] of Object.entries(d.env_refs ?? {})) if (!VAR.test(k) || !VAR.test(v)) bad('An environment reference is NAME -> VARIABLE, both plain names.');
  for (const [k, v] of Object.entries(d.header_refs ?? {})) if (!/^[A-Za-z0-9-]{1,64}$/.test(k) || !VAR.test(v)) bad('A header reference is Header-Name -> VARIABLE.');
}

/** Claude Code's `.mcp.json` entry. References become `${VAR}`, which Claude expands itself. */
export function toClaude(d: McpServerDef): Record<string, unknown> {
  const ref = (v: string) => '${' + v + '}'; const env = { ...Object.fromEntries(Object.entries(d.env_refs ?? {}).map(([k, v]) => [k, ref(v)])), ...(d.env ?? {}) };
  if (d.transport === 'stdio') return { type: 'stdio', command: d.command, ...(d.args?.length ? { args: d.args } : {}), ...(Object.keys(env).length ? { env } : {}) };
  const headers = Object.fromEntries(Object.entries(d.header_refs ?? {}).map(([k, v]) => [k, k.toLowerCase() === 'authorization' ? 'Bearer ' + ref(v) : ref(v)]));
  return { type: d.transport, url: d.url, ...(Object.keys(headers).length ? { headers } : {}) };
}
export interface CodexTable { keys: [string, string | string[] | Record<string, string>][]; notes: string[] }
/** Codex's `[mcp_servers.<name>]` table, as key/value pairs ready to print. What Codex cannot express is refused or listed in `notes`. */
export function toCodex(d: McpServerDef): CodexTable {
  const keys: CodexTable['keys'] = []; const notes: string[] = [];
  if (d.transport === 'sse') throw new McpError('unsupported', 'Codex does not support sse servers; use http.');
  if (d.transport === 'stdio') {
    keys.push(['command', d.command!]); if (d.args?.length) keys.push(['args', d.args]);
    const refs = Object.entries(d.env_refs ?? {}); if (refs.some(([k, v]) => k !== v)) throw new McpError('unsupported', 'Codex can only pass an environment variable on under its own name.'); if (refs.length) keys.push(['env_vars', refs.map(([k]) => k)]);
    if (d.env && Object.keys(d.env).length) keys.push(['env', d.env]);
  } else {
    keys.push(['url', d.url!]); const h = Object.entries(d.header_refs ?? {}); const auth = h.find(([k]) => k.toLowerCase() === 'authorization'); if (auth) keys.push(['bearer_token_env_var', auth[1]]);
    const other = h.filter(([k]) => k.toLowerCase() !== 'authorization'); if (other.length) keys.push(['env_http_headers', Object.fromEntries(other)]);
  }
  notes.push('Codex key names follow its documentation and should be checked against the installed version.'); return { keys, notes };
}
