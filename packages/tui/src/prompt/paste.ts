/** Big pastes become a short chip in the box and are put back when the message is sent. */
export interface Paste { n: number; chip: string; text: string }
export const PASTE_LINES = 10; export const PASTE_CHARS = 2000; export const PASTE_CAP = 256 * 1024;
export class PasteStore {
  private items: Paste[] = []; private total = 0;
  /** Returns the text to put in the box (the text itself, or a chip) and a warning when something was cut. */
  add(text: string): { insert: string; warning?: string } {
    let warning: string | undefined; let t = text;
    if (this.total + Buffer.byteLength(t) > PASTE_CAP) { const room = Math.max(0, PASTE_CAP - this.total); t = Buffer.from(t).subarray(0, room).toString('utf8').replace(/�+$/, ''); warning = 'That paste was too big, so only the first 256 KiB was kept.'; }
    this.total += Buffer.byteLength(t); const lines = t.split('\n').length;
    if (lines <= PASTE_LINES && t.length <= PASTE_CHARS) return { insert: t, warning };
    const n = this.items.length + 1; const chip = `[Pasted text #${n} +${lines - 1} lines]`; this.items.push({ n, chip, text: t }); return { insert: chip, warning };
  }
  /** The message with every chip that is still in it replaced by its text. */
  expand(message: string): string { let out = message; for (const p of this.items) out = out.split(p.chip).join(p.text); return out; }
  pastes(message: string): Paste[] { return this.items.filter((p) => message.includes(p.chip)); }
  clear(): void { this.items = []; this.total = 0; }
}
