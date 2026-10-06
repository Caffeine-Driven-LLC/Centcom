/** Makes untrusted text (model output, tool results, other people's names) safe to print: escape sequences, OSC commands and control characters are removed; newlines and tabs stay. */
// eslint-disable-next-line no-control-regex
const SEQ = /\x1b\][\s\S]*?(?:\x07|\x1b\\|$)|\x1b[P^_][\s\S]*?(?:\x1b\\|$)|\x1b\[[0-?]*[ -/]*[@-~]|\x1b[@-Z\\-_]|\x9b[0-?]*[ -/]*[@-~]|\x9d[\s\S]*?(?:\x07|\x9c|$)/g;
// eslint-disable-next-line no-control-regex
const CTRL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g;
export function sanitizeForTerminal(s: string): string { return typeof s === 'string' ? s.replace(SEQ, '').replace(/\r\n?/g, '\n').replace(CTRL, '') : ''; }
