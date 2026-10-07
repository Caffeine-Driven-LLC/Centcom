import React, { useState } from 'react';
import { Box, useInput } from 'ink';
import { Rich } from '../components/ui.js';
import { sp, type Line } from '../util/text.js';
import { CODES, COMMENT_UI_CAP, GLYPH, glyphOf, type CommentView, type MemberId, type MsgId, type ReactionCode, type ReactionSummary } from './model.js';

export const MUTED_REASON = 'Muted by host'; export const TOO_LONG = `Comments can have up to ${COMMENT_UI_CAP.toLocaleString('en-US')} characters.`;
export interface ReactionBarProps { target: MsgId; reactions: ReactionSummary[]; selfMember: MemberId; canReact: boolean; onToggle(code: ReactionCode): void; /** shown when the bar is off, e.g. `Muted by host` */ disabledReason?: string; /** keys 1 to 6 toggle a reaction while this is true */ active?: boolean }
/** The summary row (`+1 2  <3 1`, yours bold) and, when allowed, the picker row. Each glyph is followed by its count so a screen reader gets words, not colour. */
export function ReactionBar({ reactions, canReact, onToggle, disabledReason, active = false }: ReactionBarProps): React.JSX.Element {
  useInput((input) => { if (!active || !canReact) return; const i = Number(input); if (Number.isInteger(i) && i >= 1 && i <= CODES.length) onToggle(CODES[i - 1]!); });
  const row: Line = reactions.flatMap((r, i) => [sp(i ? '  ' : '', {}), sp(`${glyphOf(r.code)} ${r.count}`, { c: r.mine ? 'accent.primary' : 'text.primary', b: r.mine, u: r.mine })]);
  const picker: Line = canReact ? CODES.flatMap((c, i) => [sp(i ? '  ' : '', {}), sp(String(i + 1), { c: 'text.muted' }), sp(` ${GLYPH[c]}`, { c: 'text.secondary' })]) : [sp(disabledReason ?? '', { c: 'text.muted', d: true })];
  return <Box flexDirection="column">{row.length ? <Rich line={row} /> : null}{picker.length && (canReact || disabledReason) ? <Rich line={picker} /> : null}</Box>;
}
export interface CommentThreadProps { target: MsgId; comments: CommentView[]; canComment: boolean; onAdd(text: string): Promise<void>; nameOf?(m: MemberId): string | undefined; disabledReason?: string; active?: boolean; onError?(msg: string): void }
/** The comments under a message and a one-line composer (Enter sends, 2,000 characters at most). */
export function CommentThread({ comments, canComment, onAdd, nameOf, disabledReason, active = true, onError }: CommentThreadProps): React.JSX.Element {
  const [text, setText] = useState(''); const [hint, setHint] = useState<string | undefined>(); const [busy, setBusy] = useState(false);
  useInput((input, key) => {
    if (!active || !canComment || busy) return;
    if (key.return) { if (!text.trim()) return; setBusy(true); void onAdd(text).then(() => { setText(''); setHint(undefined); }).catch((e: unknown) => { onError?.(e instanceof Error ? e.message : 'failed'); }).finally(() => setBusy(false)); return; }
    if (key.backspace || key.delete) { setText((t) => t.slice(0, -1)); setHint(undefined); return; } if (key.ctrl || key.meta || key.escape || key.tab || key.upArrow || key.downArrow || key.leftArrow || key.rightArrow || !input) return;
    setText((t) => { if (t.length + input.length > COMMENT_UI_CAP) { setHint(TOO_LONG); return t; } setHint(undefined); return t + input; });
  });
  return (
    <Box flexDirection="column">
      {comments.map((c) => <Rich key={c.id} line={[sp(`${nameOf?.(c.member) ?? 'someone'}: `, { c: 'text.secondary', b: true }), sp(c.text, { c: 'text.primary' })]} />)}
      {canComment ? <Rich line={[sp('> ', { c: 'accent.primary' }), sp(text || (busy ? '' : 'comment…'), { c: text ? 'text.primary' : 'text.muted' }), sp(busy ? ' (sending…)' : '', { c: 'text.muted' })]} /> : <Rich line={[sp(disabledReason ?? '', { c: 'text.muted', d: true })]} />}
      {hint ? <Rich line={[sp(hint, { c: 'status.warning' })]} /> : null}
    </Box>
  );
}
