/** pnpm exec tsx tools/docs/config-doc.ts > docs/configuration.md   (generated from the schema, so the reference cannot drift) */
import { SCHEMA, KEYS } from '../../packages/config/src/index.ts';
const rows = KEYS.map((k) => { const s = SCHEMA[k] as { kind: string; default: unknown; enum?: readonly string[]; min?: number; max?: number; project?: boolean; doc: string }; const t = s.kind === 'enum' ? s.enum!.join(' \\| ') : s.kind === 'number' ? `number (${s.min} to ${s.max})` : s.kind; return `| \`${k}\` | ${t} | \`${JSON.stringify(s.default)}\` | ${s.project ? 'yes' : 'no'} | ${s.doc} |`; });
console.log(`# Configuration

Generated from \`packages/config/src/schema.ts\`. Do not edit by hand: run \`pnpm exec tsx tools/docs/config-doc.ts > docs/configuration.md\`.

## Where settings come from

From lowest to highest priority: **built-in defaults, your user file, the project file, environment variables, command-line flags.** A later layer overrides only the keys it sets. \`/config\` shows every setting in effect and which layer it came from.

| Layer | Location |
|---|---|
| User file | \`$CENTCOM_CONFIG_DIR/config.json\`, else \`$XDG_CONFIG_HOME/centcom/config.json\` (Linux, default \`~/.config/centcom\`), \`~/Library/Application Support/centcom/config.json\` (macOS), \`%APPDATA%\\centcom\\config.json\` (Windows) |
| Project file | \`.centcom/config.json\`, the nearest one from the working folder up to the git toplevel (never beyond it, at most 25 levels). Outside a git repo the search stops below your home folder, and a folder outside your home folder only looks at itself; the state folder's own \`config.json\` is never a project file |
| Environment | \`CENTCOM_API_URL\`, \`CENTCOM_RELAY_URL\`, \`CENTCOM_LOG_LEVEL\`, \`CENTCOM_REDUCED_MOTION\` (or the older \`CENTCOM_REDUCE_MOTION\`), \`CENTCOM_TELEMETRY=on|off\`, \`DO_NOT_TRACK\`, \`NO_COLOR\`, \`CENTCOM_CONFIG_DIR\`, \`CENTCOM_STATE_DIR\` |
| Flags | \`--theme\`, \`--mascot\`, \`--cento-color\`, \`--model\`, \`--mode\`, \`--colors\`, \`--engine\`, \`--no-motion\` (used for that run only, never written back) |

State that is not settings (saved conversations, prompt history, the web token) lives in \`$CENTCOM_STATE_DIR\`, default \`~/.centcom\`.

## Safety rules

- A **project file** may only set the keys marked "yes" below, so a cloned repository cannot redirect traffic, enable telemetry or loosen permissions. Other keys are ignored with a warning.
- Any key that looks like a credential (token, secret, password, api key, private) in any file makes Centcom ignore that file and warn, naming the key and never the value.
- \`DO_NOT_TRACK\` and \`CENTCOM_TELEMETRY=off\` always win over every file and flag.
- **Skip-permissions is never saved.** It can only be chosen on purpose each session (\`--dangerously-skip-permissions\`, \`/mode bypass\`, or the web menu). \`client.permission_mode\` only stores ask first, accept edits or plan.
- A config file that cannot be read, parsed or validated never stops Centcom: a bad project file is ignored, a bad user file falls back to the defaults, and a warning is shown. A user file that cannot be parsed is never overwritten.
- A project file that sets \`client.model\` produces a notice, since it can change what a session costs.
- Files are written atomically with mode 0600; a crash mid-write leaves the old file intact.

## What the client remembers for you

When you change them in the app, these are saved to your user file: theme, Cento size and color, reduced motion, model, permission mode (not skip-permissions), auto skills, the side and session panels, and your last agent. Prompt history is kept per project (200 entries). Saved conversations are described in the README.

## Keys

| Key | Values | Default | Project may set | Meaning |
|---|---|---|---|---|
${rows.join('\n')}
`);
