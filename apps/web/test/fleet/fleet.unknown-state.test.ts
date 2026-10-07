import { describe, expect, it, vi } from 'vitest';
import { spawn, state, store } from './helpers.js';

describe('unknown states (acceptance 3)', () => {
  it('show as working, are logged once at debug with no content, and do not break the order', () => { const log = vi.fn(); const s = store(0, log); spawn(s, 'a'); state(s, 'a', 'quantum-flux'); state(s, 'a', 'quantum-flux'); const c = s.cards()[0]!; expect(c.word).toBe('Working'); expect(c.unknown).toBe(true); expect(c.tier).toBe(4); expect(log).toHaveBeenCalledTimes(1); expect(log).toHaveBeenCalledWith('fleet.unknown_state'); expect(JSON.stringify(log.mock.calls)).not.toContain('quantum'); });
  it('a known state is a plain sentence, an exited agent says how it ended, the neutral label is Agent N until a label arrives', () => { const s = store(); spawn(s, 'a'); state(s, 'a', 'editing-file'); expect(s.cards()[0]).toMatchObject({ word: 'Cento is editing a file', label: 'Agent 1', unknown: false }); spawn(s, 'b', 'mem_b'); expect(s.cards().find((c) => c.agentId === 'b')!.label).toBe('Agent 2'); spawn(s, 'c', 'mem_c', { label: 'refactor' }); expect(s.cards().find((c) => c.agentId === 'c')!.label).toBe('refactor'); });
});
