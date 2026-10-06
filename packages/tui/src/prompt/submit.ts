/** What may be sent: not empty, and not longer than the message limit (the `message.user` text limit of 65,536). */
export const MAX_MESSAGE = 65_536;
export type Checked = { ok: true; text: string } | { ok: false; error?: string };
export function checkSubmit(text: string): Checked {
  if (!text.trim()) return { ok: false };
  if ([...text].length > MAX_MESSAGE) return { ok: false, error: 'Message is too long (max 65,536 characters).' };
  return { ok: true, text };
}
/** `\` then enter is a newline in terminals that cannot report shift+enter. */
export function continuesLine(text: string): boolean { return text.endsWith('\\'); }
