import { t, type MessageKey } from './index.js';
/** The words for an error: its own message when the code is known, else the text for its HTTP status class. Never text from the server. */
export function errorText(code: string | undefined, status?: number): string {
  const key = `error.${code ?? ''}` as MessageKey; if (code && (en as Record<string, unknown>)[key] !== undefined) return t(key);
  const s = status ?? 0; const k: MessageKey = s === 400 ? 'error.status.400' : s === 401 ? 'error.status.401' : s === 403 ? 'error.status.403' : s === 404 ? 'error.status.404' : s === 409 ? 'error.status.409' : s === 429 ? 'error.status.429' : s >= 500 ? 'error.status.5xx' : 'error.status.other'; return t(k);
}
import en from './en.json';
