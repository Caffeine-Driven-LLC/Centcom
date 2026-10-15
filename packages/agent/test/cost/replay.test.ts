import { describe, expect, it } from 'vitest';
import { replayThroughGuard } from '../../src/index.js';

const line = (id: string, sec: number, out: number) => JSON.stringify({ type: 'assistant', timestamp: new Date(Date.UTC(2026, 0, 1) + sec * 1000).toISOString(), message: { id, model: 'm', content: [], usage: { input_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: out } } });

describe('replaying a recorded session through the budget guard', () => {
  it('finds where the guard first pauses, in the order the requests happened across the main and sub-agent files', () => {
    const main = Array.from({ length: 10 }, (_, i) => line(`m${i}`, i * 10, 100)); const sub = Array.from({ length: 100 }, (_, i) => line(`s${i}`, i * 10 + 5, 1000));
    const r = replayThroughGuard(main, [sub], { runRequests: 30, runOutputTokens: 0, runUsd: 0 });
    expect(r.total.requests).toBe(110); expect(r.firstPause).toMatchObject({ atRequest: 30, reason: 'run_requests' }); expect(r.asks).toBe(3); expect(r.savedOutputShare).toBeGreaterThan(0.6);
  });
  it('would not pause a small session', () => { const r = replayThroughGuard([line('a', 0, 50), line('b', 5, 50)], []); expect(r.firstPause).toBeUndefined(); expect(r.asks).toBe(0); expect(r.savedOutputShare).toBe(0); });
});
