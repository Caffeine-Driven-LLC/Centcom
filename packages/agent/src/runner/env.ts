/** The environment a child engine process gets. Anything not named here is dropped, including every CENTCOM_* variable except CENTCOM_AGENT_ID. */
const EXACT = new Set(['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'LANGUAGE', 'TERM', 'COLORTERM', 'NO_COLOR', 'FORCE_COLOR', 'TMPDIR', 'TMP', 'TEMP', 'TZ',
  'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'no_proxy', 'all_proxy', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'NODE_EXTRA_CA_CERTS',
  'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME', 'XDG_STATE_HOME', 'XDG_RUNTIME_DIR',
  // variables the vendor CLIs read; passed through without looking at them
  'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_MODEL', 'CLAUDE_CONFIG_DIR', 'OPENAI_API_KEY', 'OPENAI_BASE_URL', 'OPENAI_ORG_ID', 'CODEX_HOME']);
const WINDOWS = new Set(['SystemRoot', 'SYSTEMROOT', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'ComSpec', 'COMSPEC', 'PATHEXT', 'USERNAME', 'HOMEDRIVE', 'HOMEPATH', 'ProgramData', 'ProgramFiles', 'windir']);
const EXACT_UPPER = new Set([...EXACT].map((k) => k.toUpperCase())); const WINDOWS_UPPER = new Set([...WINDOWS].map((k) => k.toUpperCase()));

export function childEnv(parent: Record<string, string | undefined>, agentId: string, platform: NodeJS.Platform = process.platform): Record<string, string> {
  const out: Record<string, string> = {};
  const win = platform === 'win32'; // Windows names are case-insensitive ("Path" is the stock spelling), so match folded and keep the original casing
  for (const [k, v] of Object.entries(parent)) {
    if (v === undefined) continue; const f = win ? k.toUpperCase() : k;
    if (win ? (EXACT_UPPER.has(f) || f.startsWith('LC_') || WINDOWS_UPPER.has(f)) : (EXACT.has(k) || k.startsWith('LC_'))) out[k] = v;
  }
  out.CENTCOM_AGENT_ID = agentId; return out;
}
