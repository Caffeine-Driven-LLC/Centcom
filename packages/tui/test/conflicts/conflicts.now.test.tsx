import React from 'react';
import { Text } from 'ink';
import { describe, expect, it } from 'vitest';
import { renderInk } from '../../../testkit/src/index.js';
import { useNow } from '../../src/conflicts/index.js';

const Clock = ({ t }: { t: { v: number } }) => <Text>{`t=${useNow({ everyMs: 20, now: () => t.v })}`}</Text>;
describe('useNow', () => {
  it('moves on by itself and stops when the component goes away', async () => {
    const t = { v: 1000 }; const r = await renderInk(<Clock t={t} />); expect(r.screen()[0]).toBe('t=1000'); t.v = 2000; await new Promise((x) => setTimeout(x, 80)); expect(r.screen()[0]).toBe('t=2000'); r.unmount(); const n = r.frames.length; t.v = 3000; await new Promise((x) => setTimeout(x, 80)); expect(r.frames.length).toBe(n);
  });
});
