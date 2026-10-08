/** Pieces of the conversation people want elsewhere: the last answer, its code, the whole thing as Markdown. Secrets are scrubbed from anything that leaves the app. */
import { redact } from '@centcom/protocol';
import type { Item } from '../state/model.js';

export function lastAnswer(items: Item[]): string | undefined {
  for (let i = items.length - 1; i >= 0; i--) { const it = items[i]!; if (it.kind === 'assistant' && it.text.trim()) return it.text; }
  return undefined;
}
/** The contents of every fenced code block in `text`, in order. */
export function codeBlocks(text: string): string[] {
  const out: string[] = []; const re = /(^|\n)(`{3,}|~{3,})[^\n]*\n([\s\S]*?)\n?\2[ \t]*(?=\n|$)/g; let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push(m[3]!);
  return out;
}
const fence = (body: string, lang = ''): string => { const f = '`'.repeat(Math.max(3, ...[...body.matchAll(/`+/g)].map((x) => x[0].length + 1))); return `${f}${lang}\n${body.replace(/\n$/, '')}\n${f}`; };

export function toMarkdown(items: Item[], meta: { title: string; engine: string; cwd: string; when: Date }): string {
  const out: string[] = [`# ${meta.title}`, '', `Exported ${meta.when.toISOString().slice(0, 16).replace('T', ' ')} from \`${meta.cwd}\` (${meta.engine}).`, ''];
  for (const it of items) {
    if (it.kind === 'user') out.push('## You', '', it.text, '');
    else if (it.kind === 'assistant') { if (it.text.trim()) out.push('## Cento', '', it.text, ''); }
    else if (it.kind === 'tool') {
      out.push(`> **${it.name}** ${it.summary}${it.status === 'ok' ? '' : ` (${it.status})`}`, '');
      if (it.diff) out.push(fence(it.diff, 'diff'), '');
      else if (it.result) out.push(fence(it.result.split('\n').slice(0, 20).join('\n')), '');
    } else if (it.kind === 'notice') out.push(`> _${it.level}: ${it.text}_${it.detail ? `\n> ${it.detail.split('\n').join('\n> ')}` : ''}`, '');
  }
  return redact(out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n');
}
