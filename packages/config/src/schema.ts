/** The key set, its types, defaults, and which keys a project file may set. One table drives validation, defaults, env mapping and docs. */
export type Kind = 'string' | 'number' | 'boolean' | 'enum';
export interface KeySpec { kind: Kind; default: string | number | boolean; enum?: readonly string[]; min?: number; max?: number; project?: boolean; doc: string }

export const SCHEMA = {
  'api.base_url': { kind: 'string', default: 'https://api.centcom.dev', doc: 'Backend REST base URL' },
  'relay.url': { kind: 'string', default: 'wss://relay.centcom.dev/v1/ws', doc: 'Hosted relay WebSocket URL' },
  'net.timeout_ms': { kind: 'number', default: 15000, min: 1000, max: 600000, doc: 'Per-request network timeout' },
  'net.max_attempts': { kind: 'number', default: 5, min: 1, max: 20, doc: 'Retry attempts for network calls' },
  'budget.session_usd': { kind: 'number', default: 0, min: 0, max: 100000, doc: 'Warn when a session\'s reported cost passes 80 % and 100 % of this (0 = off). Only warns; nothing is stopped' },
  'telemetry.enabled': { kind: 'boolean', default: false, doc: 'Anonymous usage reporting (off unless you turn it on)' },
  'log.level': { kind: 'enum', default: 'info', enum: ['debug', 'info', 'warn', 'error', 'silent'], project: true, doc: 'How much to write to the log file' },
  'log.max_file_bytes': { kind: 'number', default: 5242880, min: 65536, max: 268435456, doc: 'Rotate the log file at this size' },
  'log.max_files': { kind: 'number', default: 3, min: 1, max: 20, doc: 'How many rotated log files to keep' },
  'ui.theme': { kind: 'enum', default: 'auto', enum: ['auto', 'dark', 'light'], project: true, doc: 'Graphite (dark), Paper (light), or follow the system' },
  'ui.mascot': { kind: 'boolean', default: true, project: true, doc: 'Show Cento' },
  'ui.mouse': { kind: 'boolean', default: true, doc: 'Scroll with the mouse wheel in the terminal app (off gives the terminal its own text selection back)' },
  'ui.reduced_motion': { kind: 'boolean', default: false, project: true, doc: 'Turn animation off' },
  'ui.color': { kind: 'enum', default: 'auto', enum: ['auto', 'truecolor', '256', '16', 'never'], project: true, doc: 'Terminal color depth' },
  'a11y.screen_reader': { kind: 'boolean', default: false, doc: 'Plain text for screen readers: no colour, no boxes, no animation, no redraws; one line per event. Same as --screen-reader or CENTO_SCREEN_READER=1' },
  'lan.enabled': { kind: 'boolean', default: true, doc: 'Allow LAN sessions' },
  'agent.max_parallel': { kind: 'number', default: 4, min: 1, max: 16, project: true, doc: 'Most agents running at once' },
  'agent.approval_timeout_ms': { kind: 'number', default: 600000, min: 1000, max: 86400000, project: true, doc: 'How long an approval waits before it is declined' },
  // what the client remembers between sessions (never secrets; "skip permissions" is deliberately not storable)
  'client.engine': { kind: 'enum', default: 'claude-code', enum: ['claude-code', 'codex'], doc: 'Last agent you used' },
  'client.model': { kind: 'string', default: '', project: true, doc: 'Model id passed to the agent (empty = the CLI default)' },
  'client.permission_mode': { kind: 'enum', default: 'default', enum: ['default', 'acceptEdits', 'plan'], doc: 'Permission mode at start. Skip-permissions can only be chosen on purpose, each time' },
  'client.cento_color': { kind: 'enum', default: 'violet', enum: ['violet', 'red', 'yellow', 'green', 'brown'], project: true, doc: "Cento's color" },
  'client.mascot_size': { kind: 'enum', default: 'auto', enum: ['auto', 'large', 'small', 'off'], project: true, doc: 'Cento size in the terminal' },
  'client.auto_skills': { kind: 'boolean', default: true, project: true, doc: 'Pick matching skills for each message' },
  'client.side_panel': { kind: 'boolean', default: true, doc: 'Show the side panel in the web app' },
  'client.fleet_panel': { kind: 'boolean', default: true, doc: 'Show the session panel in the terminal when others join' },
} as const satisfies Record<string, KeySpec>;

export type Key = keyof typeof SCHEMA;
export const KEYS = Object.keys(SCHEMA) as Key[];
/** Any key whose name looks like a credential is refused outright, wherever it appears. */
export const SECRET_RE = /token|secret|password|api_?key|private/i;
