import { describe, expect, it } from 'vitest';
import { signalLadder } from '../../src/index.js';
import { alive, recording, start } from './rig.js';

describe.skipIf(process.platform === 'win32')('process tree cleanup', () => {
  it('a grandchild does not survive the interrupt, and only the registered pid (as a group) is signalled', async () => {
    const { child, ready, exited } = await start('spawns-grandchild'); const gpid = Number(ready.split(' ')[1]); expect(alive(gpid)).toBe(true);
    const { procs, sent } = recording(); procs.register('a', child.pid!, { group: true });
    await signalLadder({ agentId: 'a', procs, exited, graceMs: 300, killMs: 600 });
    for (let i = 0; i < 50 && alive(gpid); i++) await new Promise((r) => setTimeout(r, 20));
    expect(alive(gpid)).toBe(false); expect(new Set(sent.map((s) => s.pid))).toEqual(new Set([-child.pid!]));
  });
  it('killAll stops every registered group (used when Centcom exits)', async () => {
    const { child, exited } = await start('ignores-sigterm'); const { procs } = recording(); procs.register('a', child.pid!, { group: true }); procs.killAll(); await exited; expect(alive(child.pid!)).toBe(false);
  });
});
