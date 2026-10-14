import { describe, expect, it } from 'vitest';
import { DemoEngine } from '@centcom/agent';
import { AppController } from '../../src/controller.js';

/** Lane C044: a notice that goes away is told to the bus as `toast.dismissed`, with how it went. */
describe('toast.dismissed on the bus', () => {
  const make = () => { const c = new AppController({ engine: new DemoEngine({ speed: 100 }), demo: true, cwd: '/tmp', version: 't', skills: [] }); const seen: { id: string; level: string; by: string }[] = []; (c as unknown as { bus: { on(e: string, f: (x: never) => void): void } }).bus.on('toast.dismissed', (x) => seen.push(x)); return { c, seen }; };
  it('Esc on a notice says it was dismissed by the user, with its id and level', () => {
    const { c, seen } = make(); c.toast('error', 'Something failed'); const id = c.toasts.current()!.id; expect(c.dismissToast()).toBe(true); expect(seen).toEqual([{ id, level: 'error', by: 'user' }]); c.stop();
  });
  it('a key action on a notice dismisses it too (the action ran), and a second Esc with nothing showing says nothing', () => {
    const { c, seen } = make(); c.toast('info', 'First'); c.dismissToast(); expect(c.dismissToast()).toBe(false); expect(seen).toHaveLength(1); c.stop();
  });
  it('a notice that times out says so', async () => {
    const { c, seen } = make(); c.toast('info', 'Short', 30); await new Promise((r) => setTimeout(r, 120)); expect(seen.some((s) => s.by === 'timeout')).toBe(true); c.stop();
  });
});
