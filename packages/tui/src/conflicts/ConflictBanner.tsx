import React, { useRef, useState } from 'react';
import { Box, useInput } from 'ink';
import { CentcomError, userMessage } from '@centcom/net';
import { Rich } from '../components/ui.js';
import type { ToastInput } from '../toast/controller.js';
import { sp, truncate, type Line } from '../util/text.js';
import { ACTIONS, MSG, type ResolveAction } from './messages.js';
import { fileLabel, type ConflictView } from './model.js';

export interface ConflictBannerProps {
  conflict: ConflictView; onResolve(action: ResolveAction): void | Promise<void>; /** who owns an agent, for the line "between Ada's agent and ..." */ ownerOf?(agent: string): string | undefined;
  /** a failed action shows up here as a danger toast */ toast?(t: ToastInput): void; /** listen for the keys w t b r (default true) */ active?: boolean; width?: number;
}
export const errorText = (e: unknown): string => (e instanceof CentcomError ? userMessage(e).title : e instanceof Error ? e.message.slice(0, 120) : 'unknown error');

/** Persistent until the conflict resolves. `!` plus the words carry the meaning, colour only adds to it. */
export function ConflictBanner({ conflict, onResolve, ownerOf, toast, active = true, width = 80 }: ConflictBannerProps): React.JSX.Element {
  const [pending, setPending] = useState<ResolveAction | undefined>(); const [confirm, setConfirm] = useState(false); const busy = useRef(false);
  const files = (conflict.displayPaths?.length ? conflict.displayPaths : conflict.pathHmacs.map((h) => fileLabel(h))).slice(0, 3).join(', ') || 'a file'; const owners = [...new Set(conflict.agents.map((a) => ownerOf?.(a) ?? MSG.anAgent))].join(' and ');
  const run = (a: ResolveAction): void => {
    if (busy.current) return; busy.current = true; setPending(a); setConfirm(false);
    void Promise.resolve().then(() => onResolve(a)).catch((e: unknown) => { toast?.({ level: 'error', text: MSG.failed(errorText(e)), key: `conflict:${conflict.id}` }); }).finally(() => { busy.current = false; setPending(undefined); });
  };
  useInput((input) => {
    if (!active || busy.current) return; const i = input.toLowerCase();
    if (confirm) { if (i === 'y') run('resolve-with-cento'); else if (i === 'n') setConfirm(false); return; }
    const act = ACTIONS.find((a) => a.key === i); if (!act) return; if (act.id === 'resolve-with-cento') setConfirm(true); else run(act.id);
  });
  const head: Line = [sp(truncate(MSG.conflict(files), width), { c: 'status.danger', b: true })]; const who: Line = [sp(truncate(MSG.between(owners), width), { c: 'text.secondary' })];
  const keys: Line = ACTIONS.flatMap((a, i) => [sp(i ? '  ' : '', {}), sp(`${a.key}`, { c: pending ? 'text.muted' : 'accent.primary', b: true }), sp(` ${a.label}`, { c: pending ? 'text.muted' : 'text.primary', d: !!pending })]);
  return (
    <Box flexDirection="column">
      <Rich line={head} /><Rich line={who} />
      {confirm ? <Rich line={[sp(truncate(MSG.confirmResolve, width), { c: 'status.warning' })]} /> : <Rich line={keys} />}
      {pending ? <Rich line={[sp(`${MSG.pending} ${MSG.pendingReason}`, { c: 'text.muted' })]} /> : null}
    </Box>
  );
}

/** At most two banners; the rest fold into `+N more`. */
export function ConflictStack({ conflicts, limit = 2, ...rest }: Omit<ConflictBannerProps, 'conflict'> & { conflicts: ConflictView[]; limit?: number }): React.JSX.Element {
  const shown = conflicts.slice(0, limit); const extra = conflicts.length - shown.length;
  return <Box flexDirection="column">{shown.map((c, i) => <ConflictBanner key={c.id} conflict={c} {...rest} active={rest.active !== false && i === 0} />)}{extra > 0 ? <Rich line={[sp(MSG.more(extra), { c: 'text.muted' })]} /> : null}</Box>;
}
