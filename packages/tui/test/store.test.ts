import { describe, expect, it, vi } from 'vitest';
import { Store } from '../src/state/store.js';

describe('store', () => {
  it('updates state at once but coalesces notifications', async () => {
    vi.useFakeTimers(); const st = new Store({ n: 0 }, 20); let calls = 0; st.subscribe(() => calls++);
    for (let i = 1; i <= 50; i++) st.set({ n: i });
    expect(st.get().n).toBe(50); expect(calls).toBe(1); // leading edge only so far
    await vi.advanceTimersByTimeAsync(25); expect(calls).toBe(2); // one trailing flush for the other 49
    await vi.advanceTimersByTimeAsync(100); expect(calls).toBe(2);
    vi.useRealTimers();
  });
});
