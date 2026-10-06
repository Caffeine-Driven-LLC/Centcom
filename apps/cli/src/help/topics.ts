/** Help topics that are not commands. The docs pages are generated from these too. */
export interface EnvVar { name: string; description: string }
export const ENV_VARS: EnvVar[] = [
  { name: 'NO_COLOR', description: 'turn colour off (any value but empty); status is still shown in words and glyphs' },
  { name: 'COLORTERM', description: 'truecolor or 24bit tells Centcom the terminal can show 16 million colours' },
  { name: 'CENTO_MASCOT', description: 'on or off: show or hide Cento' },
  { name: 'CENTO_REDUCE_MOTION', description: '1 turns animation off' },
  { name: 'CENTO_SPINNER', description: 'fun or plain words next to the spinner' },
  { name: 'CENTO_THEME', description: 'dark, light or auto' },
  { name: 'DO_NOT_TRACK', description: '1 turns telemetry off, whatever else is set' },
  { name: 'CENTCOM_TELEMETRY', description: 'on or off (off always wins)' },
  { name: 'CENTCOM_CONFIG_DIR', description: 'where config.json lives' },
  { name: 'CENTCOM_STATE_DIR', description: 'where saved conversations, caches and logs live (default ~/.centcom)' },
  { name: 'CENTCOM_API_URL', description: 'the backend address (for development against the mock)' },
  { name: 'CENTCOM_RELAY_URL', description: 'the relay address (for development against the mock)' },
  { name: 'CENTCOM_LOG_LEVEL', description: 'debug, info, warn, error or silent' },
];
/** What the relay can and cannot see (CT-CRYPTO section 6). The privacy page and `centcom help privacy` say exactly this. */
export const RELAY_VISIBLE = ['Frame header fields, sizes, timing and the key id (kid)', 'Queue and approval metadata (the clear parts of the session events)', 'path_hmac, a keyed hash that cannot be linked across sessions', 'Member public keys (the relay hands them out)'];
export const RELAY_NEVER = ['Message text, code, diffs, file paths, branch names and commands', 'Session keys and device private keys', 'Plaintext paths', 'Anything inside the encrypted part of a frame (ct)'];
export const TRAFFIC_NOTE = 'Traffic analysis (who talks when, and how much) is not hidden in v1.';
export const EXIT_CODES: [number, string][] = [[0, 'done'], [1, 'error'], [2, 'bad usage'], [3, 'finished, but an action needed an approval that nobody could give'], [4, 'the agent is not installed or not signed in'], [5, 'plan or rate limit'], [6, 'the agent or the service was not reachable'], [124, 'timeout'], [130, 'interrupted']];
