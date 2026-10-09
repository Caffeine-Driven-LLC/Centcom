import React from 'react';
import { Box } from 'ink';
import type { AppState } from '../state/model.js';
import { Rich, sameUnlessTyping } from './ui.js';
import { fit, sp, textWidth, truncate, truncateMiddle, type Line } from '../util/text.js';

const homeShort = (p: string) => { const h = process.env.HOME; return h && p.startsWith(h) ? '~' + p.slice(h.length) : p; };

export const Header = React.memo(HeaderImpl, sameUnlessTyping as never) as typeof HeaderImpl;
function HeaderImpl({ s, width }: { s: AppState; width: number }) {
  const me = s.agents.find((a) => a.mine);
  const kind = me?.loginKind === 'subscription' ? 'subscription' : me?.loginKind === 'api_key' ? 'API key' : me?.loginKind === 'cloud' ? 'cloud' : s.demo ? 'demo' : '';
  const right: Line = [sp('● ', { c: s.demo ? 'status.warning' : 'signal' }), sp(s.engineLabel, { c: 'text.primary', b: true }), ...(me?.model ? [sp(' · ' + truncate(me.model, 22), { c: 'text.secondary' })] : []), ...(kind ? [sp(' · ' + kind, { c: 'text.muted' })] : [])];
  const rw = right.reduce((n, x) => n + textWidth(x.t), 0);
  const leftMax = Math.max(8, width - rw - 4);
  const left: Line = [sp('◆ ', { c: 'accent.primary', b: true }), sp('centcom', { c: 'accent.hover', b: true }), sp(' ' + truncateMiddle(homeShort(s.cwd), Math.max(8, leftMax - 24)), { c: 'text.secondary' }), ...(s.branch ? [sp('  @ ' + truncate(s.branch, 22), { c: 'text.muted' })] : [])];
  const lw = left.reduce((n, x) => n + textWidth(x.t), 0);
  return <Box height={1} width={width}><Rich line={fit([...left, sp(' '.repeat(Math.max(1, width - lw - rw - 2))), ...right, sp(' ')], width)} /></Box>;
}
