import React from 'react';
import { Text } from 'ink';
import { describe, expect, it } from 'vitest';
import { renderInk } from '../../../testkit/src/index.js';
import { ConflictStore, useConflicts } from '../../src/conflicts/index.js';

const H = 'ab12'.repeat(10);
const View = ({ s }: { s: ConflictStore }) => { const { locks, conflicts } = useConflicts(s); return <Text>{`locks=${locks.length} conflicts=${conflicts.length}`}</Text>; };
describe('useConflicts', () => {
  it('re-renders when a lock or a conflict arrives and when it ends', async () => {
    const s = new ConflictStore(); const r = await renderInk(<View s={s} />); expect(r.screen()[0]).toBe('locks=0 conflicts=0');
    s.apply({ kind: 'file.lock', seq: 1, from: 'm', ts: '2026-10-07T12:00:00.000Z', p: { action: 'acquire', path_hmac: H, agent_id: 'a1' } }); s.apply({ kind: 'conflict.detected', seq: 2, from: 'm', ts: '2026-10-07T12:00:00.000Z', p: { agent_ids: ['a1'], path_hmac: [], path_hmacs: [H] } }); await new Promise((x) => setTimeout(x, 30)); expect(r.screen()[0]).toBe('locks=1 conflicts=1');
    s.apply({ kind: 'file.lock', seq: 3, from: 'm', ts: '2026-10-07T12:00:01.000Z', p: { action: 'release', path_hmac: H, agent_id: 'a1' } }); await new Promise((x) => setTimeout(x, 30)); expect(r.screen()[0]).toBe('locks=0 conflicts=1'); r.unmount();
  });
});
