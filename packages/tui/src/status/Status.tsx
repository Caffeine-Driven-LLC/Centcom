import React from 'react';
import { Box } from 'ink';
import { Rich } from '../components/ui.js';
import { sp } from '../util/text.js';
import { bannerText, type ServiceStatus } from './banner.js';
import { SEP, layoutStatus, type StatusFields, type StatusSegment, type Tone } from './layout.js';
import { textWidth } from '../util/text.js';

const TONE: Record<Tone, 'text.muted' | 'status.warning' | 'status.danger'> = { muted: 'text.muted', warning: 'status.warning', danger: 'status.danger' };
function Line({ segs, width }: { segs: StatusSegment[]; width: number }) {
  const side = (s: 'left' | 'right') => segs.filter((x) => x.side === s).flatMap((x, i) => [...(i ? [sp(SEP, { c: 'text.muted' })] : []), sp(x.text, { c: TONE[x.tone], b: x.tone !== 'muted' })]);
  const l = side('left'); const r = side('right'); const lw = textWidth(segs.filter((x) => x.side === 'left').map((x) => x.text).join(SEP)); const rw = textWidth(segs.filter((x) => x.side === 'right').map((x) => x.text).join(SEP));
  return <Box width={width}><Rich line={[...l, ...(r.length ? [sp(' '.repeat(Math.max(2, width - lw - rw)), { c: 'text.muted' }), ...r] : [])]} /></Box>;
}
export function StatusHeader({ fields, width = 80 }: { fields: StatusFields; width?: number }) { return <Line segs={layoutStatus(fields, width, undefined, 'header')} width={width} />; }
export function StatusFooter({ fields, width = 80 }: { fields: StatusFields; width?: number }) { return <Line segs={layoutStatus(fields, width, undefined, 'footer')} width={width} />; }
export function ServiceBanner({ status, hostedSession = true, width = 80 }: { status: ServiceStatus | null; hostedSession?: boolean; width?: number }) {
  const t = bannerText(status, hostedSession); if (!t) return null;
  return <Box width={width}><Rich line={[sp(status?.status === 'major_outage' ? '✗ ' : '! ', { c: status?.status === 'major_outage' ? 'status.danger' : 'status.warning', b: true }), sp(t, { c: 'text.muted' })]} /></Box>;
}
