/** The linear mode for screen readers: plain lines appended in order, no colour, no cursor movement, no boxes. */
import type { NormalisedEvent } from '@centcom/agent';
import { BLOCKING, describeState } from './states.js';

/* every control character goes: a screen reader must never meet an escape sequence */
export const plain = (s: string): string => s.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\u001b\][^\u0007]*(\u0007|\u001b\\)/g, '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').replace(/\r/g, '');
export function announce(out: { write(s: string): unknown }, text: string, level: 'polite' | 'assertive'): void { out.write(`${level === 'assertive' ? 'Error: ' : 'Status: '}${plain(text).replace(/\n+/g, ' ').trim()}\n`); }
export type Answer = 'y' | 'n' | 'a';
export interface LinearDeps { out: { write(s: string): unknown }; /** Resolves with the next typed line, or undefined when input ends. */ readLine: (prompt: string) => Promise<string | undefined> }
export interface LinearRenderer { handle(ev: NormalisedEvent): void; /** Asks, line by line, until it gets y, n or a. Never answers by itself: no timeout, no default. Ending the input is a no. */ ask(p: { command?: string; cwd?: string; summary: string; tool: string }): Promise<Answer>; prompt(): Promise<string | undefined>; line(text: string): void }

export function createLinearRenderer(d: LinearDeps): LinearRenderer {
  const w = (t: string) => d.out.write(plain(t).replace(/\n+$/, '') + '\n'); let last = ''; let count = 0;
  return {
    line: w, prompt: () => d.readLine('> '),
    handle(ev) {
      switch (ev.type) {
        case 'text.done': if (ev.text) w(`Assistant: ${ev.text}`); break;
        case 'tool.requested': w(`Tool: ${ev.name} ${ev.input_summary}`.trim()); break;
        case 'tool.result': w(`Result: ${ev.summary}${ev.status === 'ok' ? '' : ` (${ev.status})`}`); break;
        case 'status': { if (ev.state === last) break; last = ev.state; count = ev.state === 'editing-file' ? count + 1 : 0; const t = describeState(ev.state, { count: ev.state === 'editing-file' && count > 1 ? count : undefined }); announce(d.out, `${t}.`, BLOCKING.has(ev.state) ? 'assertive' : 'polite'); break; }
        case 'error': announce(d.out, ev.tool_message, ev.fatal ? 'assertive' : 'polite'); break;
        case 'engine.warning': announce(d.out, ev.text, 'polite'); break;
        case 'turn.done': w(ev.outcome === 'ok' ? 'Done.' : ev.outcome === 'canceled' ? 'Stopped.' : 'Finished with an error.'); break;
        case 'question.asked': w(`Question: ${ev.text}${ev.options?.length ? ` (${ev.options.join(' / ')})` : ''}`); break;
        default: break;
      }
    },
    async ask(p) {
      const text = p.command ? `Allow Cento to run: ${plain(p.command).replace(/\n/g, ' ')}${p.cwd ? ` in ${plain(p.cwd)}` : ''}? [y/n/a] ` : `Allow Cento to use ${p.tool}: ${plain(p.summary).replace(/\n/g, ' ')}? [y/n/a] `;
      for (;;) { const a = await d.readLine(text); if (a === undefined) return 'n'; const v = a.trim().toLowerCase(); if (v === 'y' || v === 'n' || v === 'a') return v; w('Please type y, n or a.'); }
    },
  };
}
/** Test helpers: no colour codes anywhere, and a status always shows its word. */
export function assertNoColorCodes(output: string): void { if (/\u001b\[[0-9;]*m/.test(output) || /\u001b\[(3|4|9|10)\d/.test(output)) throw new Error('colour codes found in the output'); }
export function assertNoEscape(output: string): void { if (/\u001b/.test(output)) throw new Error('escape sequence found in the output'); }
export function assertGlyphAndWord(output: string, words: string[]): void { for (const w of words) if (!output.toLowerCase().includes(w.toLowerCase())) throw new Error(`the word "${w}" is missing from the output`); }
